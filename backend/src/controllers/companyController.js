const { pool } = require('../config/db');
const { NJEIS_FORMS_BUCKET, uploadFile, getSignedUrl, removeFiles } = require('../config/storage');

// A resized/compressed PNG data URL comfortably fits well under this — this
// mainly guards against a client sending an uncompressed original by mistake.
// Mirrors MAX_PROFILE_PICTURE_BASE64_LENGTH in index.js.
const MAX_LOGO_BASE64_LENGTH = 2_000_000; // ~1.5MB decoded

// Excel reference documents are larger than a logo but still bounded by
// express.json's 10mb body limit (index.js) — this leaves headroom for the
// base64 inflation (~33%) on top of the JSON envelope.
const MAX_COMPLIANCE_DOC_BASE64_LENGTH = 7_000_000; // ~5.2MB decoded
const COMPLIANCE_DOC_PREFIX = 'company/compliance-reference/';
const COMPLIANCE_DOC_EXTENSIONS = ['.xlsx', '.xls'];

const getCompanySettings = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM company_settings WHERE id = 1');
    res.json({ success: true, settings: rows[0] || null });
  } catch (error) {
    console.error('Error fetching company settings:', error);
    res.status(500).json({ error: 'Failed to fetch company settings' });
  }
};

const updateCompanySettings = async (req, res) => {
  const { display_name, legal_entity_name, state, timezone, address, phone, billing_email } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO company_settings (id, display_name, legal_entity_name, state, timezone, address, phone, billing_email, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         legal_entity_name = EXCLUDED.legal_entity_name,
         state = EXCLUDED.state,
         timezone = EXCLUDED.timezone,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         billing_email = EXCLUDED.billing_email,
         updated_at = now()
       RETURNING *`,
      [display_name, legal_entity_name, state, timezone, address, phone, billing_email]
    );
    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error updating company settings:', error);
    res.status(500).json({ error: 'Failed to update company settings' });
  }
};

const updateCompanyLogo = async (req, res) => {
  const { logo } = req.body;
  try {
    if (logo !== null && (typeof logo !== 'string' || !logo.startsWith('data:image/'))) {
      return res.status(400).json({ error: 'logo must be a data:image/... URL or null' });
    }
    if (logo && logo.length > MAX_LOGO_BASE64_LENGTH) {
      return res.status(400).json({ error: 'Image is too large — please use a smaller logo.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO company_settings (id, logo, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET logo = EXCLUDED.logo, updated_at = now()
       RETURNING *`,
      [logo]
    );
    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error updating company logo:', error);
    res.status(500).json({ error: 'Failed to update company logo' });
  }
};

const uploadComplianceDoc = async (req, res) => {
  const { filename, fileBase64 } = req.body;
  try {
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'filename is required' });
    }
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (!COMPLIANCE_DOC_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: 'Only .xlsx or .xls files are supported' });
    }
    if (typeof fileBase64 !== 'string' || !fileBase64.includes(',')) {
      return res.status(400).json({ error: 'fileBase64 must be a data: URL' });
    }
    if (fileBase64.length > MAX_COMPLIANCE_DOC_BASE64_LENGTH) {
      return res.status(400).json({ error: 'File is too large — please use a file under 5MB.' });
    }

    const base64Data = fileBase64.slice(fileBase64.indexOf(',') + 1);
    const buffer = Buffer.from(base64Data, 'base64');
    const path = `${COMPLIANCE_DOC_PREFIX}${Date.now()}-${filename}`;
    const contentType = ext === '.xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.ms-excel';

    const { rows: existing } = await pool.query('SELECT compliance_doc_path FROM company_settings WHERE id = 1');
    const previousPath = existing[0]?.compliance_doc_path;

    await uploadFile(NJEIS_FORMS_BUCKET, path, buffer, contentType);

    const { rows } = await pool.query(
      `INSERT INTO company_settings (id, compliance_doc_path, compliance_doc_filename, compliance_doc_size, compliance_doc_uploaded_at, updated_at)
       VALUES (1, $1, $2, $3, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         compliance_doc_path = EXCLUDED.compliance_doc_path,
         compliance_doc_filename = EXCLUDED.compliance_doc_filename,
         compliance_doc_size = EXCLUDED.compliance_doc_size,
         compliance_doc_uploaded_at = EXCLUDED.compliance_doc_uploaded_at,
         updated_at = now()
       RETURNING *`,
      [path, filename, buffer.length]
    );

    if (previousPath && previousPath !== path) {
      await removeFiles(NJEIS_FORMS_BUCKET, [previousPath]).catch(() => {});
    }

    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error uploading compliance document:', error);
    res.status(500).json({ error: 'Failed to upload compliance document' });
  }
};

const removeComplianceDoc = async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT compliance_doc_path FROM company_settings WHERE id = 1');
    const path = existing[0]?.compliance_doc_path;

    const { rows } = await pool.query(
      `UPDATE company_settings SET
         compliance_doc_path = NULL,
         compliance_doc_filename = NULL,
         compliance_doc_size = NULL,
         compliance_doc_uploaded_at = NULL,
         updated_at = now()
       WHERE id = 1
       RETURNING *`
    );

    if (path) await removeFiles(NJEIS_FORMS_BUCKET, [path]).catch(() => {});

    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error removing compliance document:', error);
    res.status(500).json({ error: 'Failed to remove compliance document' });
  }
};

const getComplianceDocDownloadUrl = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT compliance_doc_path FROM company_settings WHERE id = 1');
    const path = rows[0]?.compliance_doc_path;
    if (!path) return res.status(404).json({ error: 'No compliance document on file' });

    const signedUrl = await getSignedUrl(NJEIS_FORMS_BUCKET, path, 300); // short-lived, single-click download
    res.json({ success: true, url: signedUrl });
  } catch (error) {
    console.error('Error generating compliance document download URL:', error);
    res.status(500).json({ error: 'Failed to generate download link' });
  }
};

module.exports = {
  getCompanySettings,
  updateCompanySettings,
  updateCompanyLogo,
  uploadComplianceDoc,
  removeComplianceDoc,
  getComplianceDocDownloadUrl,
};
