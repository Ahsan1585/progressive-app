const { AsyncLocalStorage } = require('async_hooks');

// Single source of truth for "which tenant database is this request talking
// to" — set once per request by tenant-resolution middleware (either
// resolveTenantBySlug for public slug-carrying routes, or protect for
// already-authenticated requests reading tenantDb off the JWT), then read
// by db.js's Proxy on every query. Using AsyncLocalStorage (not a request
// property) means the tenant follows the async call chain automatically,
// including into code that doesn't have `req` in scope.
const als = new AsyncLocalStorage();

function runWithTenant(tenantDb, fn) {
  return als.run({ tenantDb }, fn);
}

function getCurrentTenantDb() {
  const store = als.getStore();
  if (!store?.tenantDb) {
    throw new Error('No tenant context set for this request — a route is missing tenant-resolution middleware.');
  }
  return store.tenantDb;
}

module.exports = { runWithTenant, getCurrentTenantDb };
