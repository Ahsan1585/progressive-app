const { platformPool } = require('../config/platformDb');

// Deliberately no PHI in this response — only registry metadata (see the
// multi-tenant-foundation plan, section F/G).
const listCompanies = async (req, res) => {
  try {
    const { rows } = await platformPool.query(
      `SELECT slug, display_name, status, trial_ends_at, created_at
       FROM companies ORDER BY created_at DESC`
    );
    res.json({ success: true, companies: rows });
  } catch (error) {
    console.error('Error listing companies:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { listCompanies };
