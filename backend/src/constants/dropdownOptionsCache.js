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
//
// Both caches below are dynamic — keyed by whatever categories exist in
// this tenant's dropdown_categories table (built-in + custom), not a fixed
// list. A category with zero options yet still gets an empty array key so
// consumers don't need an `|| []` guard for a brand-new custom category.
const cacheByTenant = new Map(); // tenantDbName -> { <category key>: [...], ... }
const categoriesByTenant = new Map(); // tenantDbName -> [{ key, display_name, is_custom, is_required_on_log, sort_order }, ...]
const loadedAtByTenant = new Map(); // tenantDbName -> ms timestamp of last load, for TTL below

// Cloud Run runs multiple instances of this service; each holds its own
// in-memory copy of this cache. A write (e.g. an admin adding a custom
// category) calls loadDropdownOptionsCache() to refresh — but only on the
// instance that handled that request. Every sibling instance keeps serving
// its old snapshot indefinitely (no TTL, no cross-instance broadcast),
// which silently dropped newly-added custom category fields from session
// submissions whenever they landed on a different instance. This TTL makes
// every instance self-heal within a bounded window instead of staying wrong
// until it happens to restart.
const CACHE_TTL_MS = 30_000;

async function loadDropdownOptionsCache(tenantDbName = getCurrentTenantDb()) {
  const { rows: categoryRows } = await pool.query(
    'SELECT key, display_name, is_custom, is_required_on_log, sort_order FROM dropdown_categories WHERE is_active = true ORDER BY sort_order, key'
  );
  const { rows: optionRows } = await pool.query(
    'SELECT id, category, code, label, sort_order, is_active FROM dropdown_options ORDER BY category, sort_order, id'
  );

  const next = {};
  for (const cat of categoryRows) next[cat.key] = [];
  for (const row of optionRows) {
    if (!next[row.category]) next[row.category] = [];
    next[row.category].push(row);
  }

  categoriesByTenant.set(tenantDbName, categoryRows);
  cacheByTenant.set(tenantDbName, next);
  loadedAtByTenant.set(tenantDbName, Date.now());
  return next;
}

async function ensureDropdownOptionsCacheLoaded(tenantDbName) {
  const loadedAt = loadedAtByTenant.get(tenantDbName);
  if (!cacheByTenant.has(tenantDbName) || !loadedAt || Date.now() - loadedAt > CACHE_TTL_MS) {
    await loadDropdownOptionsCache(tenantDbName);
  }
}

function getDropdownOptionsCache(tenantDbName = getCurrentTenantDb()) {
  return cacheByTenant.get(tenantDbName) || {};
}

function getDropdownCategoriesCache(tenantDbName = getCurrentTenantDb()) {
  return categoriesByTenant.get(tenantDbName) || [];
}

module.exports = {
  loadDropdownOptionsCache,
  ensureDropdownOptionsCacheLoaded,
  getDropdownOptionsCache,
  getDropdownCategoriesCache,
};
