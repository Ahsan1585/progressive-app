const { pool } = require('../config/db');

// A resized/compressed PNG data URL comfortably fits well under this — this
// mainly guards against a client sending an uncompressed original by mistake.
// Mirrors MAX_PROFILE_PICTURE_BASE64_LENGTH in index.js.
const MAX_LOGO_BASE64_LENGTH = 2_000_000; // ~1.5MB decoded

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

module.exports = { getCompanySettings, updateCompanySettings, updateCompanyLogo };
