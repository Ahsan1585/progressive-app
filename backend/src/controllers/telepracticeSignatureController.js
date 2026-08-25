const crypto = require('crypto');
const { pool } = require('../config/db');
const { sanitizeCustomFields } = require('../utils/customFields');
const { createAssessmentFromPayload } = require('../utils/createAssessment');
const { sendParentSignatureRequestEmail } = require('../utils/emailClient');
const { ensureDropdownOptionsCacheLoaded } = require('../constants/dropdownOptionsCache');
const { getCurrentTenantDb } = require('../config/tenantContext');
const { serviceCodeLabel, locationCodeLabel, statusCodeLabel, groupSizeCodeLabel } = require('../constants/njeis');
const { formatTime12h, formatLongDate, formatDurationLabel } = require('../utils/formatting');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches the invite-link TTL
const RESEND_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between resends of the same request
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// A patient must belong to the requesting practitioner — same check
// /api/interventions and /api/session-drafts already use.
async function assertOwnsPatient(patientId, practitionerId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM patient_practitioners WHERE patient_id = $1 AND practitioner_id = $2',
    [patientId, practitionerId]
  );
  return !!rows[0];
}

function buildSignUrl(companySlug, rawToken) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
  return `${frontendUrl}/${companySlug}/sign/${rawToken}`;
}

// =========================================================================
// Authenticated (practitioner)
// =========================================================================

// POST /api/telepractice-signatures — practitioner submits a telepractice
// session with only their own signature; a signing link is emailed to the
// parent instead of collecting a second signature in-app.
const submitTelepracticeSession = async (req, res) => {
  try {
    const {
      patientId,
      patient_first_name, patient_last_name, patient_dob, patient_county,
      practitioner_first_name, practitioner_last_name, practitioner_discipline,
      date, startTime, endTime, status, type, location, totalTime, total_time, groupSizeCategory,
      practitionerSignatureBase64,
      custom_fields,
      note,
    } = req.body;

    const finalTotalTime = total_time || totalTime || 0;
    const trustedPractitionerId = req.practitioner.practitionerId;

    if (!practitionerSignatureBase64) {
      return res.status(400).json({ error: 'Your own signature is required.' });
    }

    if (!(await assertOwnsPatient(patientId, trustedPractitionerId))) {
      return res.status(403).json({ error: 'Not authorized for this patient' });
    }

    // Service type check — same rule as a normal submission.
    const { rows: practitionerRows } = await pool.query(
      'SELECT service_types FROM practitioners WHERE id = $1',
      [trustedPractitionerId]
    );
    const submittingPractitioner = practitionerRows[0];
    if (submittingPractitioner.service_types?.length > 0 && !submittingPractitioner.service_types.includes(type)) {
      return res.status(403).json({ error: 'You are not registered to provide this service type' });
    }

    const { rows: patientRows } = await pool.query(
      'SELECT parent_email FROM patients WHERE id = $1',
      [patientId]
    );
    const parentEmail = patientRows[0]?.parent_email;
    if (!parentEmail) {
      return res.status(400).json({
        error: "This patient has no parent email on file. Add one on the patient's Edit screen before logging a telepractice session.",
        code: 'PARENT_EMAIL_MISSING',
      });
    }

    const sanitizedCustomFields = sanitizeCustomFields(custom_fields);
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenExpires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const { rows: insertedRows } = await pool.query(
      `INSERT INTO telepractice_signature_requests
         (practitioner_id, patient_id, patient_first_name, patient_last_name, patient_dob, patient_county,
          practitioner_first_name, practitioner_last_name, practitioner_discipline,
          service_date, start_time, end_time, total_time, session_status, type, location, group_size_category,
          form_data, note, practitioner_signature, parent_email, token_hash, token_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING id`,
      [
        trustedPractitionerId, patientId, patient_first_name, patient_last_name, patient_dob, patient_county,
        practitioner_first_name, practitioner_last_name, practitioner_discipline,
        date, startTime, endTime, finalTotalTime, status, type, location, groupSizeCategory || null,
        JSON.stringify({ custom_fields: sanitizedCustomFields }), note || null,
        practitionerSignatureBase64, parentEmail, tokenHash, tokenExpires,
      ]
    );

    await ensureDropdownOptionsCacheLoaded(getCurrentTenantDb());
    const signUrl = buildSignUrl(req.practitioner.slug, rawToken);
    try {
      await sendParentSignatureRequestEmail(parentEmail, {
        childFirstName: patient_first_name,
        practitionerFirstName: practitioner_first_name,
        serviceLabel: serviceCodeLabel(type),
        sessionDate: formatLongDate(date),
        startTime: formatTime12h(startTime),
        endTime: formatTime12h(endTime),
        durationLabel: formatDurationLabel(finalTotalTime),
        sessionTypeLabel: groupSizeCodeLabel(groupSizeCategory),
        locationLabel: locationCodeLabel(location),
        practitionerName: `${practitioner_first_name} ${practitioner_last_name}`.trim(),
        practitionerDisciplineLabel: practitioner_discipline,
        signUrl,
      });
    } catch (emailError) {
      console.error('Failed to send telepractice signature request email:', emailError);
    }

    res.status(201).json({ success: true, id: insertedRows[0].id, parentEmail });
  } catch (error) {
    console.error('Failed to submit telepractice session:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// GET /api/telepractice-signatures — this practitioner's own in-flight
// requests: both 'awaiting_signature' (visibility/resend) and 'signed'
// (Inbox "ready to submit"), same query returning both like
// getRejectedLogs returns 'rejected'+'declined' together.
const listTelepracticeRequests = async (req, res) => {
  try {
    const practitionerId = req.practitioner.practitionerId;
    const { rows } = await pool.query(
      `SELECT id, patient_id, patient_first_name, patient_last_name, service_date, type, status,
              parent_email, sent_at, resent_at, resend_count, signed_at, token_expires
       FROM telepractice_signature_requests
       WHERE practitioner_id = $1 AND status IN ('awaiting_signature', 'signed')
       ORDER BY sent_at DESC`,
      [practitionerId]
    );
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, requests: rows });
  } catch (error) {
    console.error('Failed to list telepractice signature requests:', error);
    res.status(500).json({ error: 'Failed to list telepractice signature requests' });
  }
};

// POST /api/telepractice-signatures/:id/resend — regenerate the token and
// re-send the email, only while still awaiting the parent's signature.
const resendTelepracticeSignatureRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const practitionerId = req.practitioner.practitionerId;

    const { rows } = await pool.query(
      `SELECT * FROM telepractice_signature_requests WHERE id = $1 AND practitioner_id = $2`,
      [id, practitionerId]
    );
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'awaiting_signature') {
      return res.status(409).json({ error: 'This request is no longer awaiting a parent signature.' });
    }

    const lastSentAt = request.resent_at || request.sent_at;
    if (lastSentAt && Date.now() - new Date(lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Please wait a few minutes before resending this link again.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenExpires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    await pool.query(
      `UPDATE telepractice_signature_requests
       SET token_hash = $1, token_expires = $2, resent_at = now(), resend_count = resend_count + 1
       WHERE id = $3`,
      [tokenHash, tokenExpires, id]
    );

    await ensureDropdownOptionsCacheLoaded(getCurrentTenantDb());
    const signUrl = buildSignUrl(req.practitioner.slug, rawToken);
    await sendParentSignatureRequestEmail(request.parent_email, {
      childFirstName: request.patient_first_name,
      practitionerFirstName: request.practitioner_first_name,
      serviceLabel: serviceCodeLabel(request.type),
      sessionDate: formatLongDate(request.service_date),
      startTime: formatTime12h(request.start_time),
      endTime: formatTime12h(request.end_time),
      durationLabel: formatDurationLabel(request.total_time),
      sessionTypeLabel: groupSizeCodeLabel(request.group_size_category),
      locationLabel: locationCodeLabel(request.location),
      practitionerName: `${request.practitioner_first_name} ${request.practitioner_last_name}`.trim(),
      practitionerDisciplineLabel: request.practitioner_discipline,
      signUrl,
      isResend: true,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to resend telepractice signature request:', error);
    res.status(500).json({ error: 'Failed to resend' });
  }
};

// GET /api/telepractice-signatures/:id — single request's full detail, for
// the practitioner's Confirm & Submit screen (read-only review before
// promoting it into a real assessment).
const getTelepracticeRequestDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const practitionerId = req.practitioner.practitionerId;
    const { rows } = await pool.query(
      `SELECT * FROM telepractice_signature_requests WHERE id = $1 AND practitioner_id = $2`,
      [id, practitionerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Request not found' });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, request: rows[0] });
  } catch (error) {
    console.error('Failed to fetch telepractice signature request:', error);
    res.status(500).json({ error: 'Failed to fetch request' });
  }
};

// POST /api/telepractice-signatures/:id/confirm — the only endpoint that
// creates a real, billing-visible assessments row for a telepractice
// session. Only valid once the parent has signed.
const confirmTelepracticeSession = async (req, res) => {
  try {
    const { id } = req.params;
    const practitionerId = req.practitioner.practitionerId;

    const { rows } = await pool.query(
      `SELECT * FROM telepractice_signature_requests WHERE id = $1 AND practitioner_id = $2`,
      [id, practitionerId]
    );
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'signed') {
      return res.status(409).json({ error: 'This request has not been signed by the parent yet.' });
    }

    // Re-validate service-type authorization at confirm time — don't trust
    // stale client state from when it was originally submitted.
    const { rows: practitionerRows } = await pool.query(
      'SELECT service_types FROM practitioners WHERE id = $1',
      [practitionerId]
    );
    const submittingPractitioner = practitionerRows[0];
    if (submittingPractitioner.service_types?.length > 0 && !submittingPractitioner.service_types.includes(request.type)) {
      return res.status(403).json({ error: 'You are not registered to provide this service type' });
    }

    const formData = request.form_data || {};
    const assessment = await createAssessmentFromPayload({
      patientId: request.patient_id, practitionerId,
      patient_first_name: request.patient_first_name, patient_last_name: request.patient_last_name,
      patient_dob: request.patient_dob, patient_county: request.patient_county,
      practitioner_first_name: request.practitioner_first_name, practitioner_last_name: request.practitioner_last_name,
      practitioner_discipline: request.practitioner_discipline,
      date: request.service_date, startTime: request.start_time, endTime: request.end_time,
      totalTime: request.total_time,
      status: request.session_status, type: request.type, location: request.location,
      groupSizeCategory: request.group_size_category,
      parentSignatureBase64: request.parent_signature, practitionerSignatureBase64: request.practitioner_signature,
      sanitizedCustomFields: formData.custom_fields || {},
      note: request.note, authorId: practitionerId, authorRole: req.practitioner.role,
    });

    await pool.query(
      `UPDATE telepractice_signature_requests
       SET status = 'completed', completed_at = now(), assessment_id = $1
       WHERE id = $2`,
      [assessment.id, id]
    );

    res.status(201).json({ success: true, message: 'Telepractice session confirmed and submitted', data: [assessment] });
  } catch (error) {
    console.error('Failed to confirm telepractice session:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// =========================================================================
// Unauthenticated, tenant-scoped-by-slug (parent)
// =========================================================================

async function lookupByToken(token) {
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(
    `SELECT * FROM telepractice_signature_requests WHERE token_hash = $1`,
    [tokenHash]
  );
  return rows[0] || null;
}

// GET /api/telepractice-signatures/:companySlug/:token — the parent's
// read-only session summary, fully humanized (no codes/abbreviations) since
// this is what the parent is attesting to by signing.
const getTelepracticeSignatureSummary = async (req, res) => {
  try {
    const request = await lookupByToken(req.params.token);
    if (!request) return res.status(404).json({ error: 'invalid', message: 'This link is not valid.' });
    if (request.status === 'signed' || request.status === 'completed') {
      return res.status(409).json({ error: 'already_signed', message: 'This session has already been signed.' });
    }
    if (new Date(request.token_expires) < new Date()) {
      return res.status(410).json({ error: 'expired', message: 'This link has expired. Ask your practitioner to resend it.' });
    }

    await ensureDropdownOptionsCacheLoaded(getCurrentTenantDb());

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      summary: {
        childName: `${request.patient_first_name || ''} ${request.patient_last_name || ''}`.trim(),
        serviceLabel: serviceCodeLabel(request.type),
        sessionDate: formatLongDate(request.service_date),
        startTime: formatTime12h(request.start_time),
        endTime: formatTime12h(request.end_time),
        durationLabel: formatDurationLabel(request.total_time),
        sessionTypeLabel: groupSizeCodeLabel(request.group_size_category),
        locationLabel: locationCodeLabel(request.location),
        statusLabel: statusCodeLabel(request.session_status),
        practitionerName: `${request.practitioner_first_name || ''} ${request.practitioner_last_name || ''}`.trim(),
        practitionerDisciplineLabel: request.practitioner_discipline,
      },
    });
  } catch (error) {
    console.error('Failed to fetch telepractice signature summary:', error);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/telepractice-signatures/:companySlug/:token/sign — the parent
// submits their signature. Re-validates everything server-side; never
// trusts the earlier GET.
const signTelepracticeSession = async (req, res) => {
  try {
    const { signatureBase64 } = req.body;
    if (!signatureBase64) {
      return res.status(400).json({ error: 'invalid', message: 'A signature is required.' });
    }

    const request = await lookupByToken(req.params.token);
    if (!request) return res.status(404).json({ error: 'invalid', message: 'This link is not valid.' });
    if (request.status === 'signed' || request.status === 'completed') {
      return res.status(409).json({ error: 'already_signed', message: 'This session has already been signed.' });
    }
    if (new Date(request.token_expires) < new Date()) {
      return res.status(410).json({ error: 'expired', message: 'This link has expired. Ask your practitioner to resend it.' });
    }

    await pool.query(
      `UPDATE telepractice_signature_requests
       SET parent_signature = $1, signed_at = now(), status = 'signed'
       WHERE id = $2 AND status = 'awaiting_signature'`,
      [signatureBase64, request.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to sign telepractice session:', error);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
};

module.exports = {
  submitTelepracticeSession,
  listTelepracticeRequests,
  resendTelepracticeSignatureRequest,
  getTelepracticeRequestDetail,
  confirmTelepracticeSession,
  getTelepracticeSignatureSummary,
  signTelepracticeSession,
};
