// E-signed disclosure consent requests (FERPA 34 CFR 99.30 / IDEA Part C
// 303.414). Staff ask the parent to sign; the parent gets a link-only
// email and signs on the public page (consentSigningController.js). A
// request that is only pending NEVER authorizes a disclosure:
// utils/recordsConsent.js#checkConsent reads records_consents only, and a
// records_consents row is created only when the parent actually signs.
//
// Patient-scoped handlers here are authorized by middleware/consentAccess.js.
const crypto = require('crypto');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { sendConsentRequestEmail } = require('../utils/emailClient');
const { getCompanyName } = require('../utils/companyName');
const { validateConsentDetails, isValidIntId, isValidUuid } = require('../utils/consentValidation');

const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same as the telepractice signing link
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Same base + shape as telepracticeSignatureController's buildSignUrl
// (FRONTEND_URL already includes the /eis base path). Frontend route:
// /consent/:companySlug/:token
function buildConsentSignUrl(companySlug, rawToken) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
  return `${frontendUrl}/consent/${companySlug}/${rawToken}`;
}

// Never token_hash.
const REQUEST_COLUMNS = `id, patient_id, recipient_name, recipient_email, purpose, record_types, consent_expires_at,
  requested_by, parent_email, request_expires_at, status, verify_locked_at, signed_at, signed_name, consent_id, created_at`;

// A pending link past its 7-day window reads as 'expired' without needing
// a sweeper job to flip the stored status.
const effectiveStatus = (row) => (
  row.status === 'pending' && row.request_expires_at && new Date(row.request_expires_at) <= new Date()
    ? 'expired'
    : row.status
);

const toApi = (row) => ({
  id: row.id,
  patientId: row.patient_id,
  recipientName: row.recipient_name,
  recipientEmail: row.recipient_email,
  purpose: row.purpose,
  recordTypes: row.record_types,
  consentExpiresAt: row.consent_expires_at,
  requestedBy: row.requested_by,
  parentEmail: row.parent_email,
  status: effectiveStatus(row),
  locked: !!row.verify_locked_at,
  requestedAt: row.created_at,
  requestExpiresAt: row.request_expires_at,
  signedAt: row.signed_at,
  signedName: row.signed_name,
  consentId: row.consent_id,
});

const PATIENT_NOT_FOUND = { success: false, error: 'Patient not found.' };
const REQUEST_NOT_FOUND = { success: false, error: 'Consent request not found.' };
const NO_PARENT_EMAIL = 'This child has no parent email on file. Add one first.';
const EMAIL_FAILED = 'We could not send the consent request email to the parent. Please check the parent email and try again.';

async function getParentEmail(patientId) {
  const { rows } = await pool.query('SELECT parent_email FROM patients WHERE id = $1', [patientId]);
  const email = rows[0]?.parent_email;
  return email && String(email).trim() ? String(email).trim() : null;
}

// POST /api/patients/:id/consent-requests
const createConsentRequest = async (req, res) => {
  const { id } = req.params;
  if (!isValidIntId(id)) return res.status(404).json(PATIENT_NOT_FOUND);
  const details = validateConsentDetails(req.body || {});
  if (details.error) return res.status(400).json({ success: false, error: details.error });
  const { recipientName, recipientEmail, purpose, recordTypes, expiresAt } = details.value;

  try {
    const parentEmail = await getParentEmail(id);
    if (!parentEmail) return res.status(400).json({ success: false, error: NO_PARENT_EMAIL, code: 'PARENT_EMAIL_MISSING' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const requestExpiresAt = new Date(Date.now() + REQUEST_TTL_MS);
    const { rows } = await pool.query(
      `INSERT INTO records_consent_requests
         (patient_id, recipient_name, recipient_email, purpose, record_types, consent_expires_at, requested_by, parent_email, token_hash, request_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${REQUEST_COLUMNS}`,
      [id, recipientName, recipientEmail, purpose, recordTypes, expiresAt, req.practitioner.practitionerId, parentEmail, hashToken(rawToken), requestExpiresAt]
    );
    const request = rows[0];

    try {
      await sendConsentRequestEmail(parentEmail, {
        signUrl: buildConsentSignUrl(req.practitioner.slug, rawToken),
        organizationName: await getCompanyName(),
      });
    } catch (emailError) {
      console.error('Failed to send consent request email:', emailError.message);
      // The link never reached the parent; don't leave a live token behind.
      await pool.query("UPDATE records_consent_requests SET status = 'cancelled' WHERE id = $1", [request.id]);
      return res.status(502).json({ success: false, error: EMAIL_FAILED });
    }

    logAudit({
      req, action: 'consent_request_created', resourceType: 'patient', resourceId: id,
      details: { requestId: request.id, recordTypeCount: recordTypes.length },
    });

    res.status(201).json({ success: true, request: toApi(request) });
  } catch (error) {
    console.error('Error creating consent request:', error);
    res.status(500).json({ success: false, error: 'Failed to create consent request.' });
  }
};

// GET /api/patients/:id/consent-requests
const listConsentRequests = async (req, res) => {
  if (!isValidIntId(req.params.id)) return res.status(404).json(PATIENT_NOT_FOUND);
  try {
    const { rows } = await pool.query(
      `SELECT ${REQUEST_COLUMNS} FROM records_consent_requests WHERE patient_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, requests: rows.map(toApi) });
  } catch (error) {
    console.error('Error listing consent requests:', error);
    res.status(500).json({ success: false, error: 'Failed to load consent requests.' });
  }
};

// POST /api/patients/:id/consent-requests/:requestId/resend — new token, new
// 7-day window, attempt lock cleared. Only while pending or expired.
const resendConsentRequest = async (req, res) => {
  const { id, requestId } = req.params;
  if (!isValidIntId(id)) return res.status(404).json(PATIENT_NOT_FOUND);
  if (!isValidUuid(requestId)) return res.status(404).json(REQUEST_NOT_FOUND);
  try {
    // token_hash + attempt state are read only so a failed send can put the
    // old link back (below); toApi never exposes them.
    const { rows } = await pool.query(
      `SELECT ${REQUEST_COLUMNS}, token_hash, verify_failed_attempts FROM records_consent_requests WHERE id = $1 AND patient_id = $2`,
      [requestId, id]
    );
    const existing = rows[0];
    if (!existing) return res.status(404).json(REQUEST_NOT_FOUND);
    if (!['pending', 'expired'].includes(existing.status)) {
      return res.status(409).json({ success: false, error: `This request is already ${existing.status} and can't be resent.` });
    }

    // Each send sets request_expires_at to send time + 7 days, so the last
    // send time is derivable without a new column. Stops staff from flooding
    // a parent's inbox with repeated resends.
    const lastSentAt = new Date(existing.request_expires_at).getTime() - REQUEST_TTL_MS;
    if (Date.now() - lastSentAt < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ success: false, error: 'This request was just sent. Please wait a couple of minutes before resending.' });
    }

    // Use the child's current parent email, in case it was corrected.
    const parentEmail = await getParentEmail(id);
    if (!parentEmail) return res.status(400).json({ success: false, error: NO_PARENT_EMAIL, code: 'PARENT_EMAIL_MISSING' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const newHash = hashToken(rawToken);
    const requestExpiresAt = new Date(Date.now() + REQUEST_TTL_MS);
    const { rows: updated } = await pool.query(
      `UPDATE records_consent_requests
       SET token_hash = $1, request_expires_at = $2, parent_email = $3, status = 'pending',
           verify_failed_attempts = 0, verify_locked_at = NULL
       WHERE id = $4 AND patient_id = $5 AND status IN ('pending', 'expired')
       RETURNING ${REQUEST_COLUMNS}`,
      [newHash, requestExpiresAt, parentEmail, requestId, id]
    );
    if (!updated[0]) return res.status(409).json({ success: false, error: 'This request can no longer be resent.' });

    try {
      await sendConsentRequestEmail(parentEmail, {
        signUrl: buildConsentSignUrl(req.practitioner.slug, rawToken),
        organizationName: await getCompanyName(),
        isResend: true,
      });
    } catch (emailError) {
      console.error('Failed to resend consent request email:', emailError.message);
      // The new link never reached the parent. Put the previous token,
      // window, status and attempt lock back so the link they already have
      // keeps working (and a locked link stays locked). Guarded by the new
      // hash so it only undoes this rotation, never a later one.
      try {
        await pool.query(
          `UPDATE records_consent_requests
           SET token_hash = $1, request_expires_at = $2, status = $3,
               verify_failed_attempts = $4, verify_locked_at = $5
           WHERE id = $6 AND token_hash = $7`,
          [existing.token_hash, existing.request_expires_at, existing.status,
            existing.verify_failed_attempts ?? 0, existing.verify_locked_at ?? null, requestId, newHash]
        );
      } catch (restoreError) {
        console.error('Failed to restore consent request after resend email failure:', restoreError.message);
      }
      return res.status(502).json({ success: false, error: EMAIL_FAILED });
    }

    logAudit({
      req, action: 'consent_request_resent', resourceType: 'patient', resourceId: id,
      details: { requestId },
    });

    res.json({ success: true, request: toApi(updated[0]) });
  } catch (error) {
    console.error('Error resending consent request:', error);
    res.status(500).json({ success: false, error: 'Failed to resend consent request.' });
  }
};

// DELETE /api/patients/:id/consent-requests/:requestId — cancel; only while
// pending (a lapsed-but-unsigned link may be cancelled too).
const cancelConsentRequest = async (req, res) => {
  const { id, requestId } = req.params;
  if (!isValidIntId(id)) return res.status(404).json(PATIENT_NOT_FOUND);
  if (!isValidUuid(requestId)) return res.status(404).json(REQUEST_NOT_FOUND);
  try {
    const { rows } = await pool.query(
      `UPDATE records_consent_requests SET status = 'cancelled'
       WHERE id = $1 AND patient_id = $2 AND status = 'pending'
       RETURNING id`,
      [requestId, id]
    );
    if (!rows[0]) {
      const { rows: existing } = await pool.query(
        'SELECT status FROM records_consent_requests WHERE id = $1 AND patient_id = $2',
        [requestId, id]
      );
      if (!existing[0]) return res.status(404).json(REQUEST_NOT_FOUND);
      return res.status(409).json({ success: false, error: `This request is already ${existing[0].status} and can't be cancelled.` });
    }

    logAudit({
      req, action: 'consent_request_cancelled', resourceType: 'patient', resourceId: id,
      details: { requestId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling consent request:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel consent request.' });
  }
};

// GET /api/consent-requests/pending — every child's requests (admin or
// patient_record_rights only), live pending ones first.
const listPendingConsentRequests = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.patient_id, p.first_name, p.last_name, r.recipient_name, r.status,
              r.created_at, r.request_expires_at, r.consent_expires_at
       FROM records_consent_requests r
       JOIN patients p ON p.id = r.patient_id
       ORDER BY CASE WHEN r.status = 'pending' AND r.request_expires_at > now() THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT 500`
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      requests: rows.map((r) => ({
        id: r.id,
        patientId: r.patient_id,
        patientName: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        recipientName: r.recipient_name,
        status: effectiveStatus(r),
        requestedAt: r.created_at,
        requestExpiresAt: r.request_expires_at,
        consentExpiresAt: r.consent_expires_at,
      })),
    });
  } catch (error) {
    console.error('Error listing pending consent requests:', error);
    res.status(500).json({ success: false, error: 'Failed to load consent requests.' });
  }
};

module.exports = {
  createConsentRequest,
  listConsentRequests,
  resendConsentRequest,
  cancelConsentRequest,
  listPendingConsentRequests,
  buildConsentSignUrl,
};
