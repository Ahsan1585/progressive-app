// Parent self-service for a signed consent (FERPA 34 CFR 99.30): view it,
// download a copy of what they signed, or withdraw it. Reached from the link
// emailed right after signing. Server-rendered forms (no scripts), tenant from
// the company slug, the link's token looked up by its sha256 only.
//
// The child's date of birth is required on EVERY action, claimed atomically
// against a 5-attempt lock before it is compared (same scheme as the signing
// page), so a forwarded email alone cannot withdraw or read anything.
//
// Withdrawing stops future sharing: the consent is revoked, every secure
// records link sent under it is revoked, and staff are told (neutral email).
// It cannot undo what was already shared; the page says so.
const crypto = require('crypto');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { escapeHtml, sendConsentStaffNoticeEmail } = require('../utils/emailClient');
const { sendPage, rejectPage } = require('../utils/publicHtml');
const { safeFilenamePart } = require('../utils/pdfText');
const { buildConsentCopyPdf, loadStaffNames } = require('./consentReportController');

const MAX_ATTEMPTS = 5;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const TYPE_LABEL = { session_logs: 'Session logs', sevf_forms: 'SEVF forms', invoices: 'Invoices', full_record_export: 'Full record' };

function dobToIso(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

const fmt = (value) => {
  if (!value) return 'not set';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'not set' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
};

// Returns { request } or writes the rejection and returns null.
async function loadRequest(req, res) {
  const { token } = req.params;
  if (!TOKEN_RE.test(String(token || ''))) { rejectPage(res, 404, 'This link is not valid.'); return null; }
  const { rows } = await pool.query(
    `SELECT r.*, p.dob AS patient_dob
     FROM records_consent_requests r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.manage_token_hash = $1`,
    [hashToken(token)]
  );
  const request = rows[0];
  if (!request || !request.consent_id) { rejectPage(res, 404, 'This link is not valid.'); return null; }
  if (request.manage_locked_at) {
    rejectPage(res, 423, 'This link has been locked after too many incorrect attempts. Please contact the agency.');
    return null;
  }
  return request;
}

const dobForm = (action, error) => `
  <h1>Your consent</h1>
  ${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
  <p>To protect your child's privacy, please enter your child's date of birth to continue.</p>
  <form method="post" action="${action}">
    <label for="dob">Child's date of birth</label>
    <input id="dob" type="date" name="dob" required autofocus />
    <button type="submit">Continue</button>
  </form>`;

// Race-safe DOB check: the attempt is claimed by one conditional UPDATE
// (lock check + counter + lock-at-5) before comparing, so parallel guesses
// cannot exceed the limit. Returns true if verified; otherwise it already
// responded.
async function checkDobOrFail(request, dob, req, res, retryAction) {
  const { rows } = await pool.query(
    `UPDATE records_consent_requests
     SET manage_failed_attempts = manage_failed_attempts + 1,
         manage_locked_at = CASE WHEN manage_failed_attempts + 1 >= $2 THEN now() ELSE manage_locked_at END
     WHERE id = $1 AND manage_token_hash = $3 AND manage_locked_at IS NULL AND manage_failed_attempts < $2
     RETURNING manage_failed_attempts, manage_locked_at`,
    [request.id, MAX_ATTEMPTS, request.manage_token_hash]
  );
  if (!rows[0]) {
    rejectPage(res, 423, 'This link has been locked after too many incorrect attempts. Please contact the agency.');
    return false;
  }
  const given = typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob.trim()) ? dob.trim() : null;
  const expected = dobToIso(request.patient_dob);
  if (given && expected && given === expected) {
    await pool.query(
      'UPDATE records_consent_requests SET manage_failed_attempts = 0, manage_locked_at = NULL WHERE id = $1 AND manage_token_hash = $2',
      [request.id, request.manage_token_hash]
    );
    return true;
  }
  if (rows[0].manage_locked_at) {
    logAudit({
      req, actorId: null, actorRole: 'parent',
      action: 'consent_signing_locked', resourceType: 'patient', resourceId: request.patient_id,
      details: { requestId: request.id, link: 'manage', failedAttempts: rows[0].manage_failed_attempts },
    });
    rejectPage(res, 423, 'This link has been locked after too many incorrect attempts. Please contact the agency.');
  } else {
    sendPage(res, 403, 'Your consent', dobForm(retryAction, 'We could not verify that. Please check the date and try again.'));
  }
  return false;
}

async function loadConsent(request) {
  const { rows } = await pool.query('SELECT * FROM records_consents WHERE id = $1 AND patient_id = $2', [request.consent_id, request.patient_id]);
  return rows[0] || null;
}

function consentState(consent) {
  if (consent.revoked_at) return 'withdrawn';
  if (consent.expires_at && new Date(consent.expires_at) <= new Date()) return 'expired';
  return 'active';
}

const hiddenDob = (dob) => `<input type="hidden" name="dob" value="${escapeHtml(String(dob).trim())}" />`;

function detailsPage(consent, dob, message) {
  const state = consentState(consent);
  const types = (consent.record_types || []).map((t) => TYPE_LABEL[t] || t).join(', ');
  const statusLine = {
    active: `In effect until ${fmt(consent.expires_at)}.`,
    expired: `This consent expired on ${fmt(consent.expires_at)}.`,
    withdrawn: `This consent was withdrawn on ${fmt(consent.revoked_at)}. No further records will be shared under it.`,
  }[state];
  return `
    <h1>Your consent</h1>
    ${message ? `<p class="notice" role="status">${escapeHtml(message)}</p>` : ''}
    <dl>
      <dt>Records may be shared with</dt><dd>${escapeHtml(consent.recipient_name)}</dd>
      <dt>For the purpose of</dt><dd>${escapeHtml(consent.purpose)}</dd>
      <dt>Records covered</dt><dd>${escapeHtml(types)}</dd>
      <dt>Signed</dt><dd>${escapeHtml(fmt(consent.granted_at))}</dd>
      <dt>Status</dt><dd>${escapeHtml(statusLine)}</dd>
    </dl>
    <form method="post" action="copy">${hiddenDob(dob)}<button type="submit" class="secondary">Download a copy</button></form>
    ${state === 'active' ? `
    <p>You may withdraw this consent at any time. Withdrawing stops future sharing and ends any secure links already sent. It does not undo records that were already shared.</p>
    <form method="post" action="withdraw">${hiddenDob(dob)}<button type="submit" class="danger">Withdraw my consent</button></form>` : ''}`;
}

// GET /api/consent-manage/:companySlug/:token
const getManageLanding = async (req, res) => {
  try {
    const request = await loadRequest(req, res);
    if (!request) return;
    // Nothing about the consent or child is shown before the DOB check, and
    // opening the page changes nothing (email scanners prefetch GET links).
    sendPage(res, 200, 'Your consent', dobForm(`${req.params.token}/view`));
  } catch (error) {
    console.error('getManageLanding error:', error);
    rejectPage(res, 500, 'Something went wrong. Please try again later.');
  }
};

// Shared prologue for the three POST actions.
async function verified(req, res, retryAction) {
  const request = await loadRequest(req, res);
  if (!request) return null;
  if (!(await checkDobOrFail(request, req.body?.dob, req, res, retryAction))) return null;
  const consent = await loadConsent(request);
  if (!consent) { rejectPage(res, 404, 'This link is not valid.'); return null; }
  return { request, consent };
}

// POST .../view { dob }
const viewConsent = async (req, res) => {
  try {
    const ctx = await verified(req, res, 'view');
    if (!ctx) return;
    sendPage(res, 200, 'Your consent', detailsPage(ctx.consent, req.body.dob));
  } catch (error) {
    console.error('viewConsent error:', error);
    rejectPage(res, 500, 'Something went wrong. Please try again later.');
  }
};

// POST .../withdraw { dob }
const withdrawConsent = async (req, res) => {
  try {
    const ctx = await verified(req, res, 'view');
    if (!ctx) return;
    const { request, consent } = ctx;

    const { rows } = await pool.query(
      `UPDATE records_consents
       SET revoked_at = now(), revoked_via = 'parent'
       WHERE id = $1 AND patient_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [consent.id, request.patient_id]
    );
    if (!rows[0]) {
      // Already withdrawn: show the current state, log nothing twice.
      return sendPage(res, 200, 'Your consent', detailsPage({ ...consent, revoked_at: consent.revoked_at || new Date() }, req.body.dob));
    }
    // Every secure records link sent under this consent stops working now.
    await pool.query('UPDATE records_releases SET revoked_at = now() WHERE consent_id = $1 AND revoked_at IS NULL', [consent.id]);

    logAudit({
      req, actorId: null, actorRole: 'parent',
      action: 'records_consent_revoked_by_parent', resourceType: 'patient', resourceId: request.patient_id,
      details: { consentId: consent.id, requestId: request.id },
    });
    try {
      const staff = await pool.query('SELECT email FROM practitioners WHERE id = $1 AND is_active IS NOT FALSE', [request.requested_by]);
      const email = staff?.rows?.[0]?.email;
      if (email) await sendConsentStaffNoticeEmail(email, { kind: 'withdrawn' });
    } catch (err) {
      console.error('Failed to send consent withdrawn notice:', err.message);
    }

    sendPage(res, 200, 'Your consent', detailsPage({ ...consent, revoked_at: new Date() }, req.body.dob, 'Your consent has been withdrawn.'));
  } catch (error) {
    console.error('withdrawConsent error:', error);
    rejectPage(res, 500, 'Something went wrong. Please try again later.');
  }
};

// POST .../copy { dob }
const downloadCopy = async (req, res) => {
  try {
    const ctx = await verified(req, res, 'view');
    if (!ctx) return;
    const { request, consent } = ctx;

    const staffName = await loadStaffNames([consent.granted_by]);
    const pdfBytes = await buildConsentCopyPdf({ consent, grantedByName: staffName(consent.granted_by) });

    logAudit({
      req, actorId: null, actorRole: 'parent',
      action: 'consent_copy_downloaded_by_parent', resourceType: 'patient', resourceId: request.patient_id,
      details: { consentId: consent.id },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="consent-${safeFilenamePart(consent.recipient_name)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('downloadCopy error:', error);
    rejectPage(res, 500, 'Something went wrong. Please try again later.');
  }
};

module.exports = { getManageLanding, viewConsent, withdrawConsent, downloadCopy };
