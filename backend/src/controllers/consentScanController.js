// Optional scan of the signed paper consent, kept with the consent so the
// agency can show the parent's actual signature if ever asked (34 CFR 99.30).
// The paper attestation on the consent already satisfies the requirement;
// the scan is supporting evidence.
//
// The client never chooses the storage path or the stored filename, the file's
// leading bytes must match its declared type (a PDF or image only), and it is
// served back as a forced download with nosniff, so an uploaded file cannot be
// turned into script. Stored under the tenant-scoped forms bucket.
const crypto = require('crypto');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { NJEIS_FORMS_BUCKET, uploadFile, downloadFile, removeFiles } = require('../config/storage');
const { isValidIntId } = require('../utils/consentValidation');
const { safeFilenamePart } = require('../utils/pdfText');

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = {
  'application/pdf': { ext: 'pdf', magic: (b) => b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/png': { ext: 'png', magic: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};
const BAD_FILE = { error: 'Attach a PDF, PNG or JPEG scan of 10 MB or less.' };

function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]*)$/.exec(value);
  if (!m) return null;
  const type = TYPES[m[1]];
  if (!type) return null;
  // Reject by encoded length before decoding anything large.
  if (m[2].length > Math.ceil((MAX_BYTES * 4) / 3) + 8) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_BYTES || !type.magic(buffer)) return null;
  return { mime: m[1], ext: type.ext, buffer };
}

async function loadConsent(id, consentId) {
  const { rows } = await pool.query(
    'SELECT id, patient_id, source, paper_scan_path, paper_scan_filename FROM records_consents WHERE id = $1 AND patient_id = $2',
    [consentId, id]
  );
  return rows[0] || null;
}

// POST /api/patients/:id/consents/:consentId/scan   { filename, fileBase64 }
const uploadConsentScan = async (req, res) => {
  const { id, consentId } = req.params;
  if (!isValidIntId(id) || !isValidIntId(consentId)) return res.status(404).json({ error: 'Consent not found.' });
  try {
    const consent = await loadConsent(id, consentId);
    if (!consent) return res.status(404).json({ error: 'Consent not found.' });
    if (consent.source !== 'paper') {
      return res.status(409).json({ error: 'A scan can only be attached to a paper consent.' });
    }
    const file = parseDataUrl(req.body?.fileBase64);
    if (!file) return res.status(400).json(BAD_FILE);

    const path = `consent-scans/${consent.id}-${crypto.randomBytes(12).toString('hex')}.${file.ext}`;
    await uploadFile(NJEIS_FORMS_BUCKET, path, file.buffer, file.mime);

    // Only a shown-safe label is kept from the client's filename.
    const label = `${safeFilenamePart(String(req.body?.filename || '').replace(/\.[^.]*$/, ''))}.${file.ext}`.slice(0, 120);
    await pool.query(
      `UPDATE records_consents
       SET paper_scan_path = $1, paper_scan_filename = $2, paper_scan_uploaded_at = now(), paper_scan_uploaded_by = $3
       WHERE id = $4`,
      [path, label, req.practitioner?.practitionerId ?? null, consent.id]
    );
    if (consent.paper_scan_path) {
      try { await removeFiles(NJEIS_FORMS_BUCKET, [consent.paper_scan_path]); } catch (err) { console.error('Old consent scan cleanup failed:', err.message); }
    }

    logAudit({
      req, action: 'consent_scan_uploaded', resourceType: 'patient', resourceId: String(id),
      details: { consentId: consent.id, replaced: !!consent.paper_scan_path },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('uploadConsentScan error:', error);
    res.status(500).json({ error: 'Failed to save the scan.' });
  }
};

// GET /api/patients/:id/consents/:consentId/scan
const downloadConsentScan = async (req, res) => {
  const { id, consentId } = req.params;
  if (!isValidIntId(id) || !isValidIntId(consentId)) return res.status(404).json({ error: 'Consent not found.' });
  try {
    const consent = await loadConsent(id, consentId);
    if (!consent || !consent.paper_scan_path) return res.status(404).json({ error: 'No scan on file for this consent.' });

    const buffer = await downloadFile(NJEIS_FORMS_BUCKET, consent.paper_scan_path);
    const mime = Object.keys(TYPES).find((m) => consent.paper_scan_path.endsWith(`.${TYPES[m].ext}`)) || 'application/octet-stream';

    logAudit({
      req, action: 'consent_scan_viewed', resourceType: 'patient', resourceId: String(id),
      details: { consentId: consent.id },
    });
    res.setHeader('Content-Type', mime);
    const base = safeFilenamePart(String(consent.paper_scan_filename || '').replace(/\.[^.]*$/, ''), 'consent-scan');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.${TYPES[mime]?.ext || 'bin'}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (error) {
    console.error('downloadConsentScan error:', error);
    res.status(500).json({ error: 'Failed to load the scan.' });
  }
};

module.exports = { uploadConsentScan, downloadConsentScan };
