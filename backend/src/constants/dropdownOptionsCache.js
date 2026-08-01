const { pool } = require('../config/db');
const { getCurrentTenantDb } = require('../config/tenantContext');

// njeis.js's label<->code mapping functions run synchronously (including in
// a per-row loop inside billingController's compliance analysis), so options
// are read from this in-memory cache rather than queried per lookup.
//
// Now keyed per tenant (was a single global cache/variable) — there is no
// tenant context available at process boot, so this can no longer be
// loaded once at startup the way it used to be. Instead it's lazily
// populated on first use per tenant (see ensureDropdownOptionsCacheLoaded,
// called from authMiddleware's `protect` before any request-handling code
// runs, so njeis.js's synchronous reads always find an already-warm
// cache), and refreshed synchronously by dropdownOptionsController
// whenever an admin adds/edits/deactivates/reactivates an option.
const CATEGORIES = ['service_type', 'service_status', 'location', 'group_size'];
const EMPTY_CACHE = { service_type: [], service_status: [], location: [], group_size: [] };

const cacheByTenant = new Map(); // tenantDbName -> { service_type: [...], ... }

async function loadDropdownOptionsCache(tenantDbName = getCurrentTenantDb()) {
  const { rows } = await pool.query(
    'SELECT id, category, code, label, sort_order, is_active FROM dropdown_options ORDER BY category, sort_order, id'
  );
  const next = { service_type: [], service_status: [], location: [], group_size: [] };
  for (const row of rows) {
    if (CATEGORIES.includes(row.category)) next[row.category].push(row);
  }
  cacheByTenant.set(tenantDbName, next);
  return next;
}

async function ensureDropdownOptionsCacheLoaded(tenantDbName) {
  if (!cacheByTenant.has(tenantDbName)) {
    await loadDropdownOptionsCache(tenantDbName);
  }
}

function getDropdownOptionsCache(tenantDbName = getCurrentTenantDb()) {
  return cacheByTenant.get(tenantDbName) || EMPTY_CACHE;
}

module.exports = { loadDropdownOptionsCache, ensureDropdownOptionsCacheLoaded, getDropdownOptionsCache, CATEGORIES };
