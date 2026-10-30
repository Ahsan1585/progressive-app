// In-app "Send records": an agency staff member sends the records a signed
// parental consent approves to the consent's recipient. Replaces the manual
// "generate the PDF and email it yourself" step, so the safeguards live in the
// product:
//
//  - The recipient address is the one fixed on the consent (never typed at
//    send time), and the email carries only a secure link (Resend has no BAA).
//  - Opening the link is not enough. The recipient asks for a one-time code,
//    which is emailed to that same consented address, and enters it to
//    download. Codes expire in 15 minutes, allow 5 wrong tries, and can be
//    requested at most once a minute and 10 times per release.
//  - The packet is generated fresh at download time and re-checks the
//    consent, so revoking or expiring the consent ends access immediately.
//  - Every send and every download is audited on the child's Record of
//    Disclosures (34 CFR 99.32 / 303.406); no child names in audit details.
//
// Agency users only; independent practitioners are out of scope for now.
const crypto = require('crypto');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const {
  sendRecordsReleaseEmail,
  sendRecordsReleaseCodeEmail,
  REDISCLOSURE_NOTICE,
  escapeHtml,
} = require('../utils/emailClient');
const { getCompanyName } = require('../utils/companyName');
const { isValidIntId } = require('../utils/consentValidation');
const { safeFilenamePart } = require('../utils/pdfText');
const { sendPage: send, rejectPage: reject } = require('../utils/publicHtml');
const { buildConsentPacketPdf, loadStaffNames, recipientSlug } = require('./consentReportController');
const { decryptPatientRow } = require('../utils/fieldEncryption');

const RELEASE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODE_SENDS = 10;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const SECTION_ORDER = ['session_logs', 'sevf_forms', 'invoices'];

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const hashCode = (releaseId, code) => crypto.createHash('sha256').update(`${releaseId}:${code}`).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const isActiveConsent = (c, now = new Date()) => !!c && !c.revoked_at && !(c.expires_at && new Date(c.expires_at) <= now);

// What a consent's record types mean as packet sections (full export = all three).
function approvedSections(recordTypes) {
  const types = new Set(Array.isArray(recordTypes) ? recordTypes : []);
  if (types.has('full_record_export')) return [...SECTION_ORDER];
  return SECTION_ORDER.filter((t) => types.has(t));
}

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

// ---------------------------------------------------------------------------
// Staff endpoints (mounted under /api/patients/:id, behind protect +
// loadPermissions + requireConsentAccess + patient_record_rights).
// ---------------------------------------------------------------------------

const NOT_AGENCY = { error: 'Sending records from the app is available to agency accounts.' };
const isIndependent = (req) => req.practitioner?.role === 'independent_practitioner';

// POST /api/patients/:id/consents/:consentId/releases   { recordTypes? }
const createRelease = async (req, res) => {
  if (isIndependent(req)) return res.status(403).json(NOT_AGENCY);
  const { id, consentId } = req.params;
  if (!isValidIntId(id) || !isValidIntId(consentId)) return res.status(404).json({ error: 'Consent not found.' });

  try {
    // Scoped by BOTH ids: another child's consent id is simply not found.
    const { rows } = await pool.query('SELECT * FROM records_consents WHERE id = $1 AND patient_id = $2', [consentId, id]);
    const consent = rows[0];
    if (!consent) return res.status(404).json({ error: 'Consent not found.' });
    const now = new Date();
    if (!isActiveConsent(consent, now)) {
      return res.status(409).json({ error: 'This consent is revoked or expired, so records cannot be sent.' });
    }
    if (!consent.recipient_email) {
      return res.status(409).json({
        error: 'This consent has no recipient email on file. Record a new consent with the recipient\'s email address to send records.',
      });
    }

    const approved = approvedSections(consent.record_types);
    let recordTypes = approved;
    if (req.body?.recordTypes !== undefined) {
      const asked = req.body.recordTypes;
      if (!Array.isArray(asked) || asked.length === 0 || asked.some((t) => !approved.includes(t))) {
        return res.status(400).json({ error: 'recordTypes must be a non-empty subset of what this consent approves.' });
      }
      recordTypes = SECTION_ORDER.filter((t) => asked.includes(t));
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const ttlEnd = now.getTime() + RELEASE_TTL_MS;
    const expiresAt = new Date(consent.expires_at ? Math.min(ttlEnd, new Date(consent.expires_at).getTime()) : ttlEnd);
    const { rows: ins } = await pool.query(
      `INSERT INTO records_releases
         (consent_id, patient_id, token_hash, recipient_name, recipient_email, record_types, expires_at, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, expires_at`,
      [consent.id, id, hashToken(rawToken), consent.recipient_name, consent.recipient_email, recordTypes, expiresAt,
        req.practitioner?.practitionerId ?? null]
    );
    const release = ins[0];

    const origin = String(process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const releaseUrl = `${origin}/api/released-records/${encodeURIComponent(req.practitioner.slug)}/${rawToken}`;
    try {
      await sendRecordsReleaseEmail(consent.recipient_email, {
        releaseUrl, organizationName: await getCompanyName(), expiresAt: release.expires_at,
      });
    } catch (err) {
      console.error('createRelease email error:', err.message);
      await pool.query("UPDATE records_releases SET email_status = 'failed' WHERE id = $1", [release.id]);
      return res.status(502).json({ error: 'The email could not be sent, so nothing was delivered. Please try again.', releaseId: release.id });
    }

    logAudit({
      req, action: 'records_release_sent', resourceType: 'patient', resourceId: String(id),
      details: { consentId: consent.id, releaseId: release.id, recipient: consent.recipient_name, recipientEmail: consent.recipient_email, recordTypes },
    });
    res.status(201).json({ success: true, release: { id: release.id, expiresAt: release.expires_at, recordTypes, recipientEmail: consent.recipient_email } });
  } catch (error) {
    console.error('createRelease error:', error);
    res.status(500).json({ error: 'Failed to send records.' });
  }
};

// GET /api/patients/:id/releases
const listReleases = async (req, res) => {
  if (isIndependent(req)) return res.status(403).json(NOT_AGENCY);
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.consent_id, r.recipient_name, r.recipient_email, r.record_types, r.created_at, r.expires_at,
              r.email_status, r.first_downloaded_at, r.download_count, r.revoked_at,
              p.first_name AS sent_by_first_name, p.last_name AS sent_by_last_name
       FROM records_releases r
       LEFT JOIN practitioners p ON p.id = r.sent_by
       WHERE r.patient_id = $1
       ORDER BY r.created_at DESC
       LIMIT 200`,
      [req.params.id]
    );
    const now = Date.now();
    const releases = rows.map((r) => {
      let status = 'sent';
      if (r.email_status === 'failed') status = 'failed';
      else if (r.revoked_at) status = 'revoked';
      else if (new Date(r.expires_at).getTime() <= now) status = 'expired';
      else if (r.download_count > 0) status = 'downloaded';
      return { ...r, status };
    });
    res.json({ success: true, releases });
  } catch (error) {
    console.error('listReleases error:', error);
    res.status(500).json({ error: 'Failed to load sent records.' });
  }
};

// DELETE /api/patients/:id/releases/:releaseId
const revokeRelease = async (req, res) => {
  if (isIndependent(req)) return res.status(403).json(NOT_AGENCY);
  const { id, releaseId } = req.params;
  if (!isValidIntId(id) || !isValidIntId(releaseId)) return res.status(404).json({ error: 'Not found.' });
  try {
    const { rows } = await pool.query(
      `UPDATE records_releases SET revoked_at = now()
       WHERE id = $1 AND patient_id = $2 AND revoked_at IS NULL
       RETURNING id, consent_id`,
      [releaseId, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found or already revoked.' });
    logAudit({
      req, action: 'records_release_revoked', resourceType: 'patient', resourceId: String(id),
      details: { releaseId: rows[0].id, consentId: rows[0].consent_id },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('revokeRelease error:', error);
    res.status(500).json({ error: 'Failed to revoke.' });
  }
};

// ---------------------------------------------------------------------------
// Public recipient gateway (mounted at /api/released-records, tenant from slug).
// Server-rendered HTML with plain forms: no scripts, nothing cached.
// ---------------------------------------------------------------------------

// Returns { release } or { status, message }. Also loads the consent so a
// revoked/expired consent ends access even while the link itself is alive.
async function loadRelease(token) {
  if (!TOKEN_RE.test(String(token || ''))) return { status: 404, message: 'This link is not valid.' };
  const { rows } = await pool.query('SELECT * FROM records_releases WHERE token_hash = $1', [hashToken(token)]);
  const release = rows[0];
  if (!release) return { status: 404, message: 'This link is not valid.' };
  if (release.revoked_at) return { status: 410, message: 'This link has been revoked. Please contact the agency that sent it.' };
  if (new Date(release.expires_at).getTime() <= Date.now()) {
    return { status: 410, message: 'This link has expired. Please contact the agency that sent it for a new one.' };
  }
  const { rows: cRows } = await pool.query('SELECT * FROM records_consents WHERE id = $1', [release.consent_id]);
  const consent = cRows[0];
  if (!isActiveConsent(consent)) {
    return { status: 410, message: 'The parent\'s consent for this release is no longer in effect, so these records are no longer available.' };
  }
  return { release, consent };
}

const codeForm = (error) => `
  <h1>Enter your code</h1>
  ${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
  <p>Enter the 6-digit code we emailed you. It expires in 15 minutes.</p>
  <form method="post" action="download">
    <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus />
    <button type="submit">Download records</button>
  </form>
  <form method="post" action="code"><button type="submit" style="background:#fff;color:#0E6E67;border:1px solid #0E6E67;">Email me a new code</button></form>`;

// GET /api/released-records/:companySlug/:token
const getReleaseLanding = async (req, res) => {
  try {
    const result = await loadRelease(req.params.token);
    if (!result.release) return reject(res, result.status, result.message);
    const { release } = result;
    const expires = new Date(release.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    // Opening the page is deliberately not counted as anything: email link
    // scanners prefetch GET links.
    send(res, 200, 'Secure records', `
      <h1>Secure records</h1>
      <p><b style="color:#132A3E;">${escapeHtml(release.recipient_name)}</b>, records have been shared with you under a parent's written consent.</p>
      <p class="notice"><b>Confidentiality notice:</b> ${escapeHtml(REDISCLOSURE_NOTICE)}</p>
      <p>To confirm it is you, we will email a one-time code to <b>${escapeHtml(maskEmail(release.recipient_email))}</b>.</p>
      <form method="post" action="${escapeHtml(req.params.token)}/code"><button type="submit">Email me a code</button></form>
      <p style="font-size:12px;">This private link expires on ${escapeHtml(expires)}. Downloads are logged.</p>
    `);
  } catch (error) {
    console.error('getReleaseLanding error:', error);
    reject(res, 500, 'Something went wrong. Please try again later.');
  }
};

// POST /api/released-records/:companySlug/:token/code
const requestCode = async (req, res) => {
  try {
    const result = await loadRelease(req.params.token);
    if (!result.release) return reject(res, result.status, result.message);
    const { release } = result;

    if (release.code_sends >= MAX_CODE_SENDS) {
      return reject(res, 429, 'Too many codes have been requested for this link. Please contact the agency that sent it.');
    }
    if (release.code_sent_at && Date.now() - new Date(release.code_sent_at).getTime() < CODE_COOLDOWN_MS) {
      return send(res, 429, 'Please wait', codeForm('A code was just sent. Please wait a minute before requesting another.'));
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await pool.query(
      `UPDATE records_releases
       SET code_hash = $2, code_expires_at = $3, code_sent_at = now(), code_attempts = 0, code_sends = code_sends + 1
       WHERE id = $1
       RETURNING id`,
      [release.id, hashCode(release.id, code), new Date(Date.now() + CODE_TTL_MS)]
    );
    try {
      // Always the address fixed on the consent; nothing from the request.
      await sendRecordsReleaseCodeEmail(release.recipient_email, { code, minutes: CODE_TTL_MS / 60000 });
    } catch (err) {
      console.error('requestCode email error:', err.message);
      return reject(res, 502, 'We could not send the code. Please try again in a few minutes.');
    }
    send(res, 200, 'Enter your code', codeForm(null));
  } catch (error) {
    console.error('requestCode error:', error);
    reject(res, 500, 'Something went wrong. Please try again later.');
  }
};

// POST /api/released-records/:companySlug/:token/download   { code }
const downloadRelease = async (req, res) => {
  try {
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return send(res, 400, 'Enter your code', codeForm('Enter the 6-digit code from your email.'));
    }
    const result = await loadRelease(req.params.token);
    if (!result.release) return reject(res, result.status, result.message);
    const { release, consent } = result;

    // Count the attempt BEFORE comparing, atomically, so parallel guesses
    // cannot exceed the limit. Matches only an unexpired, unlocked code.
    const { rows } = await pool.query(
      `UPDATE records_releases SET code_attempts = code_attempts + 1
       WHERE id = $1 AND code_hash IS NOT NULL AND code_expires_at > now() AND code_attempts < $2
       RETURNING id, code_hash, code_attempts`,
      [release.id, MAX_CODE_ATTEMPTS]
    );
    const row = rows[0];
    if (!row) {
      return send(res, 429, 'Request a new code', codeForm('That code is expired or too many attempts were made. Request a new code.'));
    }
    if (!safeEqual(row.code_hash, hashCode(release.id, code))) {
      const left = MAX_CODE_ATTEMPTS - row.code_attempts;
      return send(res, 403, 'Enter your code', codeForm(left > 0 ? `That code is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not correct. Request a new code.'));
    }
    // A correct entry does not burn an attempt, so the recipient can
    // re-download within the code's lifetime.
    await pool.query('UPDATE records_releases SET code_attempts = GREATEST(code_attempts - 1, 0) WHERE id = $1', [release.id]);

    const { rows: pRows } = await pool.query('SELECT * FROM patients WHERE id = $1', [release.patient_id]);
    const patient = decryptPatientRow(pRows[0]);
    if (!patient) return reject(res, 404, 'These records are no longer available.');

    const staffName = await loadStaffNames([consent.granted_by]);
    const pdfBytes = await buildConsentPacketPdf({
      patient,
      consent,
      recordTypes: release.record_types,
      generatedBy: `Secure release to ${release.recipient_name}`,
      grantedByName: staffName(consent.granted_by),
    });

    await pool.query(
      `UPDATE records_releases
       SET download_count = download_count + 1, first_downloaded_at = COALESCE(first_downloaded_at, now())
       WHERE id = $1`,
      [release.id]
    );
    logAudit({
      req,
      actorEmail: release.recipient_email,
      actorRole: 'external_recipient',
      action: 'records_release_downloaded',
      resourceType: 'patient',
      resourceId: release.patient_id,
      details: { releaseId: release.id, consentId: consent.id, recipient: release.recipient_name, recordTypes: release.record_types },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="records-${safeFilenamePart(patient.last_name)}-${recipientSlug(release.recipient_name)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Redisclosure-Notice', REDISCLOSURE_NOTICE);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('downloadRelease error:', error);
    reject(res, 500, 'Something went wrong. Please try again later.');
  }
};

module.exports = {
  createRelease,
  listReleases,
  revokeRelease,
  getReleaseLanding,
  requestCode,
  downloadRelease,
};
