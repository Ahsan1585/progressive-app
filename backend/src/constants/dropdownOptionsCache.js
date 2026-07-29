const { pool } = require('../config/db');

// njeis.js's label<->code mapping functions run synchronously (including in
// a per-row loop inside billingController's compliance analysis), so options
// are read from this in-memory cache rather than queried per lookup. Loaded
// once at boot and refreshed synchronously by dropdownOptionsController
// whenever an admin adds/edits/deactivates/reactivates an option, so the
// cache is never more than one request stale.
const CATEGORIES = ['service_type', 'service_status', 'location', 'group_size'];

let cache = { service_type: [], service_status: [], location: [], group_size: [] };

async function loadDropdownOptionsCache() {
  const { rows } = await pool.query(
    'SELECT id, category, code, label, sort_order, is_active FROM dropdown_options ORDER BY category, sort_order, id'
  );
  const next = { service_type: [], service_status: [], location: [], group_size: [] };
  for (const row of rows) {
    if (CATEGORIES.includes(row.category)) next[row.category].push(row);
  }
  cache = next;
  return cache;
}

function getDropdownOptionsCache() {
  return cache;
}

module.exports = { loadDropdownOptionsCache, getDropdownOptionsCache, CATEGORIES };
