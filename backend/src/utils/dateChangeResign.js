// Changing the date on a session note the parent already signed.
//
// The parent's signature attests to the session as it was, including its
// date, so a new date needs a new parent signature. Instead of editing the
// note, the whole edit is parked in telepractice_signature_requests as a
// kind = 'date_change' request (same secure link, DOB check, attestation and
// resend as a telepractice signature), and the note is held from billing
// (billing_status = 'awaiting_resign', which SEVF/invoice generation never
// selects). The note keeps its old date and old signature, which still agree
// with each other, until the parent signs; then the new values and the new
// signature are applied together and it goes back to its prior stage — an
// Edit Log's note returns to 'pending' (admin billing review), but a
// Resubmit's note returns to 'rejected' (the practitioner's returned-logs
// inbox), since the parent re-signing the date doesn't itself resubmit the
// log. Undo (cancel) puts it back exactly as it was. Only the date
// triggers this; other edits save as before.

const crypto = require('crypto');
const { pool } = require('../config/db');
const { sendParentSignatureRequestEmail } = require('./emailClient');
const { encryptField, decryptField } = require('./fieldEncryption');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // same 7 days as the telepractice link
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

class ParentEmailMissingError extends Error {
  constructor() {
    super("Changing the date needs the parent's new signature, and this child has no parent email on file. Add one on the child's Edit screen first.");
    this.code = 'PARENT_EMAIL_MISSING';
  }
}
// The note moved on (or the request did) between reading and writing.
class DateChangeStateError extends Error {
  constructor(message) {
    super(message);
    this.code = 'DATE_CHANGE_STATE';
  }
}

// pg hands back a `date` as a local-midnight Date (or a string in tests).
function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

function dateChanged(currentDate, newDate) {
  if (!newDate) return false;
  return toIsoDate(currentDate) !== toIsoDate(newDate);
}

function buildSignUrl(companySlug, rawToken) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
  return `${frontendUrl}/${companySlug}/sign/${rawToken}`;
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// newValues: the edited note — service_date, start_time, end_time,
// total_time, status, type, location, group_size_category, form_data, plus
// optional session_notes / company_affiliation. previousBillingStatus is
// 'pending' (Edit Log) or 'rejected' (Resubmit); resubmitNote is the
// practitioner's optional note when resubmitting a returned log.
async function requestDateChangeResign({
  assessmentId, practitionerId, companySlug, newValues, previousBillingStatus, resubmitNote = null, authorRole = null,
}) {
  const { rows } = await pool.query(
    `SELECT a.*, p.parent_email FROM assessments a JOIN patients p ON p.id = a.patient_id
      WHERE a.id = $1 AND a.practitioner_id = $2`,
    [assessmentId, practitionerId]
  );
  const a = rows[0];
  if (!a) throw new DateChangeStateError('Log not found');
  if (!a.parent_email) throw new ParentEmailMissingError();

  const rawToken = crypto.randomBytes(32).toString('hex');
  const editPayload = {
    session_notes: newValues.session_notes !== undefined ? newValues.session_notes : decryptField(a.session_notes) ?? null,
    company_affiliation: newValues.company_affiliation !== undefined ? newValues.company_affiliation : a.company_affiliation ?? null,
    resubmit_note: resubmitNote && resubmitNote.trim() ? resubmitNote.trim() : null,
    author_role: authorRole,
  };

  const requestId = await inTransaction(async (client) => {
    const { rows: inserted } = await client.query(
      `INSERT INTO telepractice_signature_requests
         (kind, assessment_id, practitioner_id, patient_id,
          patient_first_name, patient_last_name, patient_dob, patient_county,
          practitioner_first_name, practitioner_last_name, practitioner_discipline,
          previous_service_date, service_date, start_time, end_time, total_time, session_status, type, location,
          group_size_category, form_data, edit_payload,
          previous_parent_signature, practitioner_signature, previous_billing_status,
          parent_email, token_hash, token_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
               $20, $21, $22, $23, $24, $25, $26, $27, $28)
       RETURNING id`,
      [
        'date_change', a.id, a.practitioner_id, a.patient_id,
        decryptField(a.patient_first_name), decryptField(a.patient_last_name), decryptField(a.patient_dob), a.patient_county,
        a.practitioner_first_name, a.practitioner_last_name, a.practitioner_discipline,
        toIsoDate(a.service_date), toIsoDate(newValues.service_date), newValues.start_time, newValues.end_time,
        newValues.total_time, newValues.status, newValues.type, newValues.location,
        newValues.group_size_category || null, JSON.stringify(newValues.form_data || {}), JSON.stringify(editPayload),
        a.parent_signature, a.practitioner_signature, previousBillingStatus,
        a.parent_email, hashToken(rawToken), new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      ]
    );
    const held = await client.query(
      "UPDATE assessments SET billing_status = 'awaiting_resign' WHERE id = $1 AND billing_status = $2",
      [a.id, previousBillingStatus]
    );
    if (held.rowCount !== 1) throw new DateChangeStateError('This log changed while you were editing it. Please reopen it and try again.');
    return inserted[0].id;
  });

  try {
    // PHI minimization: the email carries no session detail, see emailClient.
    await sendParentSignatureRequestEmail(a.parent_email, {
      practitionerFirstName: a.practitioner_first_name,
      signUrl: buildSignUrl(companySlug, rawToken),
      reason: 'date_change',
    });
  } catch (emailError) {
    console.error('Failed to send date-change signature email:', emailError);
  }

  return { requestId, parentEmail: a.parent_email };
}

// The parent signed: record the signature on the request and apply the
// whole edit plus the new signature to the note, in one transaction.
//
// A note that was in 'pending' (Edit Log) goes back to 'pending' — the
// parent re-signed, so it's ready for the normal billing review it was
// already waiting for. A note that was 'rejected' (Resubmit) goes back to
// 'rejected' instead, keeping its rejection_note/rejected_at: the parent
// re-signing the corrected date doesn't itself resubmit the log — the
// practitioner still needs to review and resubmit it from their returned-
// logs inbox, same as any other returned log.
async function signDateChange(request, { signatureBase64, attestationText, ip, userAgent }) {
  const payload = request.edit_payload || {};
  const wasReturned = request.previous_billing_status === 'rejected';
  await inTransaction(async (client) => {
    const applied = await client.query(
      `UPDATE assessments
          SET service_date = $1, start_time = $2, end_time = $3, total_time = $4, status = $5, type = $6,
              location = $7, group_size_category = $8, form_data = $9, session_notes = $10,
              company_affiliation = $11, parent_signature = $12,
              billing_status = '${wasReturned ? 'rejected' : 'pending'}', billing_review = NULL, hold_note = NULL, held_at = NULL,
              eims_last_flagged = NULL, eims_last_missing = NULL, eims_last_checked_at = NULL
        WHERE id = $13 AND billing_status = 'awaiting_resign'`,
      [
        toIsoDate(request.service_date), request.start_time, request.end_time, request.total_time, request.session_status,
        request.type, request.location, request.group_size_category || null,
        JSON.stringify(request.form_data || {}), payload.session_notes ? encryptField(payload.session_notes) : null, payload.company_affiliation ?? null,
        signatureBase64, request.assessment_id,
      ]
    );
    if (applied.rowCount !== 1) throw new DateChangeStateError('This session is no longer waiting for your signature.');

    // EIMS matching and any one-off "Allow" were against the old date.
    await client.query('DELETE FROM compliance_field_acknowledgments WHERE assessment_id = $1', [request.assessment_id]);
    if (payload.resubmit_note) {
      await client.query(
        'INSERT INTO assessment_notes (assessment_id, author_id, author_role, note) VALUES ($1, $2, $3, $4)',
        [request.assessment_id, request.practitioner_id, payload.author_role, payload.resubmit_note]
      );
    }
    await client.query(
      `UPDATE telepractice_signature_requests
          SET parent_signature = $1, signed_at = now(), status = 'completed', completed_at = now(),
              attested = true, attestation_text = $2, signed_ip = $3, signed_user_agent = $4, dob_verified_at = now()
        WHERE id = $5 AND status = 'awaiting_signature'`,
      [signatureBase64, attestationText, ip, userAgent, request.id]
    );
  });
}

// Undo date change: close the link and put the note back as it was.
async function cancelDateChange({ requestId, practitionerId }) {
  const { rows } = await pool.query(
    `SELECT * FROM telepractice_signature_requests
      WHERE id = $1 AND practitioner_id = $2 AND kind = 'date_change'`,
    [requestId, practitionerId]
  );
  const request = rows[0];
  if (!request) throw new Error('Request not found');
  if (request.status !== 'awaiting_signature') {
    throw new DateChangeStateError('The parent has already signed, so this change can no longer be undone.');
  }
  await inTransaction(async (client) => {
    await client.query(
      "UPDATE assessments SET billing_status = $1 WHERE id = $2 AND billing_status = 'awaiting_resign'",
      [request.previous_billing_status, request.assessment_id]
    );
    await client.query(
      "UPDATE telepractice_signature_requests SET status = 'cancelled' WHERE id = $1",
      [request.id]
    );
  });
  return request;
}

module.exports = {
  dateChanged, toIsoDate, requestDateChangeResign, signDateChange, cancelDateChange,
  ParentEmailMissingError, DateChangeStateError,
};
