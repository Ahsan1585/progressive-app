const { pool } = require('../config/db');

// Every generated PDF (SEVF/NJEIS form, invoice) needs to show the
// requesting tenant's own company name, not a hardcoded one — this was
// previously hardcoded to "Progressive Steps" (the original single-tenant
// customer) in half a dozen call sites, silently wrong for every other
// tenant. legal_entity_name is preferred when set since these are legal/
// contractual documents; falls back to display_name.
async function getCompanyName() {
  const { rows } = await pool.query('SELECT display_name, legal_entity_name FROM company_settings WHERE id = 1');
  return rows[0]?.legal_entity_name || rows[0]?.display_name || '';
}

module.exports = { getCompanyName };
