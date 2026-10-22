// Public (no login) e-signing of a disclosure consent request (FERPA 34 CFR
// 99.30 / IDEA Part C 303.414). Mirrors the telepractice parent-signing
// flow: tenant resolved from the company slug in the URL
// (resolveTenantBySlug), token looked up by its sha256 only, the child's
// DOB must be confirmed before ANY request detail is shown, and every DOB
// attempt is claimed atomically with a 5-attempt lock.
//
// Signing is the ONLY place a records_consents row is created from a
// request, and it happens in one transaction with the request being marked
// signed, so a pending request can never authorize a disclosure.
const crypto = require('crypto');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { getCompanyName } = require('../utils/companyName');
const { sendConsentManageEmail } = require('../utils/emailClient');
const { notifyConsentStaff } = require('../utils/consentNotify');

const MAX_VERIFY_ATTEMPTS = 5;
const ATTESTATION_TEXT = 'I am the parent or legal guardian of this child. I authorize the disclosure described above. I understand I may revoke this consent at any time by contacting the agency, and that my electronic signature has the same legal effect as my handwritten signature.';

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');
// req.ip, never the raw X-Forwarded-For header: its leftmost entry is
// whatever the client sent. With `trust proxy` = 1 (index.js) Express already
// resolves req.ip to the address our load balancer saw.
const clientIp = (req) => req.ip || null;
const MAX_NAME_LENGTH = 120;

// Where the parent manages (views / withdraws / downloads) a signed consent.
// Server-rendered by consentManageController, so it points at this API.
function buildManageUrl(req, companySlug, rawToken) {
  const host = typeof req.get === 'function' ? req.get('host') : null;
  const origin = String(process.env.BACKEND_PUBLIC_URL || (host ? `${req.protocol || 'https'}://${host}` : '')).replace(/\/+$/, '');
  return `${origin}/api/consent-manage/${encodeURIComponent(companySlug)}/${rawToken}`;
}

// After a signing is committed: give the parent their manage link and tell the
// staff member who asked. Both are best-effort; the consent is already on file
// and neither email carries child details. (Staff are told through
// notifyConsentStaff, worded for where each person can actually look.)
async function notifyAfterSigning(req, request, rawManageToken) {
  try {
    await sendConsentManageEmail(request.parent_email, {
      manageUrl: buildManageUrl(req, req.params.companySlug, rawManageToken),
      organizationName: await getCompanyName(),
    });
  } catch (err) {
    console.error('Failed to send consent manage email:', err.message);
  }
  await notifyConsentStaff('signed', request.requested_by);
}

// patients.dob is a pg `date`: node-pg hands back a local-midnight Date (or
// a string in tests). Normalize to YYYY-MM-DD for comparison.
function dobToIso(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

async function lookupByToken(token) {
  const { rows } = await pool.query(
    `SELECT r.*, p.dob AS patient_dob, p.first_name AS patient_first_name, p.last_name AS patient_last_name
     FROM records_consent_requests r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.token_hash = $1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

const INVALID = { error: 'invalid', message: 'This link is not valid.' };
const NO_LONGER_VALID = { error: 'no_longer_valid', message: 'This link is no longer valid. Please contact the agency if you need a new one.' };
const ALREADY_SIGNED = { error: 'already_signed', message: 'This consent has already been signed.' };
const GENERIC_LOCKED = { error: 'locked', message: 'This link has been locked. Please contact the agency to send you a new link.' };
const GENERIC_VERIFY_FAILED = { error: 'verification_failed', message: 'We could not verify that information. Please check it and try again.' };
const SERVER_ERROR = { error: 'server_error', message: 'Something went wrong. Please try again.' };

// Never reveals request detail. Unknown tokens (including another tenant's,
// since the tenant comes from the slug) are 'invalid'; signed / cancelled /
// expired ones are 'no_longer_valid' (both 404). On the sign endpoint a
// signed request is 409 instead, so a double-submit is distinguishable.
// Returns true if it already wrote a response.
function linkStateError(request, res, { signedConflict = false } = {}) {
  if (!request) { res.status(404).json(INVALID); return true; }
  if (request.status === 'signed' && signedConflict) { res.status(409).json(ALREADY_SIGNED); return true; }
  if (request.status !== 'pending' || new Date(request.request_expires_at) <= new Date()) {
    res.status(404).json(NO_LONGER_VALID);
    return true;
  }
  if (request.verify_locked_at) { res.status(423).json(GENERIC_LOCKED); return true; }
  return false;
}

// Race-safe DOB check, same as telepracticeSignatureController: the attempt
// is claimed UP FRONT by one conditional UPDATE (lock check + counter +
// lock-at-5 in a single statement) before the DOB is compared, so parallel
// requests can never get more than MAX_VERIFY_ATTEMPTS guesses between
// them. A correct DOB then resets the counter (and clears a lock its own
// claim just set). Returns true if verified; otherwise it already responded.
async function checkDobOrFail(request, dob, req, res) {
  const { rows } = await pool.query(
    `UPDATE records_consent_requests
     SET verify_failed_attempts = verify_failed_attempts + 1,
         verify_locked_at = CASE WHEN verify_failed_attempts + 1 >= $2 THEN now() ELSE verify_locked_at END
     WHERE id = $1 AND token_hash = $3 AND verify_locked_at IS NULL AND verify_failed_attempts < $2
     RETURNING verify_failed_attempts, verify_locked_at`,
    [request.id, MAX_VERIFY_ATTEMPTS, request.token_hash]
  );
  if (!rows[0]) {
    res.status(423).json(GENERIC_LOCKED);
    return false;
  }

  const given = typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob.trim()) ? dob.trim() : null;
  const expected = dobToIso(request.patient_dob);
  if (given && expected && given === expected) {
    await pool.query(
      `UPDATE records_consent_requests SET verify_failed_attempts = 0, verify_locked_at = NULL
       WHERE id = $1 AND token_hash = $2`,
      [request.id, request.token_hash]
    );
    return true;
  }

  if (rows[0].verify_locked_at) {
    logAudit({
      req, actorId: null, actorRole: 'parent',
      action: 'consent_signing_locked', resourceType: 'patient', resourceId: request.patient_id,
      details: { requestId: request.id, failedAttempts: rows[0].verify_failed_attempts },
    });
    res.status(423).json(GENERIC_LOCKED);
  } else {
    res.status(403).json(GENERIC_VERIFY_FAILED);
  }
  return false;
}

// GET /api/consent-signing/:companySlug/:token — link-state check only.
const getConsentSigningState = async (req, res) => {
  try {
    const request = await lookupByToken(req.params.token);
    if (linkStateError(request, res)) return;
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, requiresVerification: true });
  } catch (error) {
    console.error('Failed to fetch consent signing link state:', error.message);
    res.status(500).json(SERVER_ERROR);
  }
};

// POST /api/consent-signing/:companySlug/:token/verify { dob }
const verifyConsentSigningIdentity = async (req, res) => {
  try {
    const request = await lookupByToken(req.params.token);
    if (linkStateError(request, res)) return;
    if (!(await checkDobOrFail(request, req.body?.dob, req, res))) return;

    const organizationName = await getCompanyName();
    res.set('Cache-Control', 'no-store');
    // Named only now that the date of birth has been confirmed.
    const childName = `${request.patient_first_name || ''} ${request.patient_last_name || ''}`.trim();
    res.json({
      success: true,
      childName,
      recipientName: request.recipient_name,
      purpose: request.purpose,
      recordTypes: request.record_types,
      consentExpiresAt: request.consent_expires_at,
      organizationName,
      attestationText: ATTESTATION_TEXT,
    });
  } catch (error) {
    console.error('Failed to verify consent signing identity:', error.message);
    res.status(500).json(SERVER_ERROR);
  }
};

// POST /api/consent-signing/:companySlug/:token/sign { dob, typedName, attested }
// Re-validates everything server-side; never trusts the verify step.
const signConsent = async (req, res) => {
  const { dob, typedName, attested } = req.body || {};
  const name = typeof typedName === 'string' ? typedName.trim() : '';
  if (name.length < 2) {
    return res.status(400).json({ error: 'name_required', message: 'Please type your full name to sign.' });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: 'name_too_long', message: `Please keep your typed name to ${MAX_NAME_LENGTH} characters or fewer.` });
  }
  if (attested !== true) {
    return res.status(400).json({ error: 'attestation_required', message: 'Please confirm the statement above before signing.' });
  }

  let client;
  try {
    const request = await lookupByToken(req.params.token);
    if (linkStateError(request, res, { signedConflict: true })) return;
    if (!(await checkDobOrFail(request, dob, req, res))) return;

    if (!request.consent_expires_at || new Date(request.consent_expires_at) <= new Date()) {
      return res.status(400).json({ error: 'consent_expired', message: 'This consent request has an end date that has already passed. Please contact the agency for a new request.' });
    }

    const ip = clientIp(req);
    const userAgent = req.headers?.['user-agent'] || null;

    // Long-lived link the parent can use later to view, download or withdraw
    // this consent. Only its hash is stored; the raw token goes in one email.
    const rawManageToken = crypto.randomBytes(32).toString('hex');

    client = await pool.connect();
    await client.query('BEGIN');
    // Claim first: only one concurrent sign can flip pending -> signed; the
    // loser sees no row and creates nothing. token_hash must still be the one
    // this link was looked up by, so a link superseded by a resend between
    // lookup and claim cannot sign.
    const { rows: claimed } = await client.query(
      `UPDATE records_consent_requests
       SET status = 'signed', signed_at = now(), signed_ip = $2, signed_user_agent = $3, signed_name = $4,
           manage_token_hash = $6
       WHERE id = $1 AND status = 'pending' AND token_hash = $5 AND request_expires_at > now()
       RETURNING id`,
      [request.id, ip, userAgent, name, request.token_hash, hashToken(rawManageToken)]
    );
    if (!claimed[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json(ALREADY_SIGNED);
    }
    const { rows: inserted } = await client.query(
      `INSERT INTO records_consents
         (patient_id, recipient_name, recipient_email, purpose, record_types, granted_by, expires_at,
          granted_at, source, identity_verified_method, identity_verified_note, proof_note,
          signed_ip, signed_user_agent, signed_name, request_id, attestation_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
          now(), 'electronic', 'electronic_dob', 'Parent confirmed the child''s date of birth on the secure signing page.', $8,
          $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        request.patient_id, request.recipient_name, request.recipient_email, request.purpose, request.record_types,
        request.requested_by, request.consent_expires_at,
        `Signed electronically. Attestation: "${ATTESTATION_TEXT}"`,
        ip, userAgent, name, request.id,
        // The exact wording the parent saw and agreed to (the verify step
        // returns this same constant), kept on its own column so the signed
        // consent copy can quote it verbatim.
        ATTESTATION_TEXT,
      ]
    );
    const consentId = inserted[0].id;
    await client.query('UPDATE records_consent_requests SET consent_id = $1 WHERE id = $2', [consentId, request.id]);
    await client.query('COMMIT');

    logAudit({
      req, actorId: null, actorRole: 'parent',
      action: 'consent_signed_electronically', resourceType: 'patient', resourceId: request.patient_id,
      details: { requestId: request.id, consentId, recordTypeCount: (request.record_types || []).length },
    });

    res.json({ success: true });
    await notifyAfterSigning(req, request, rawManageToken);
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    }
    console.error('Failed to sign consent:', error.message);
    res.status(500).json(SERVER_ERROR);
  } finally {
    if (client) client.release();
  }
};

module.exports = {
  getConsentSigningState,
  verifyConsentSigningIdentity,
  signConsent,
  ATTESTATION_TEXT,
};
