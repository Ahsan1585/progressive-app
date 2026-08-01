const { Pool, types } = require('pg');
const { buildConnectionConfig } = require('./dbConnectionConfig');

// pg parses `date` columns into JS Date objects by default — the app's
// PDF/report generation code does string ops (.split('-'), concatenation)
// directly on patient_dob/service_date/etc. expecting "YYYY-MM-DD" strings,
// so every pool (per-tenant or otherwise) must apply this same parser.
types.setTypeParser(types.builtins.DATE, (val) => val);

// One real pg.Pool per tenant database, created lazily on first use and
// evicted after a period of inactivity so a growing number of companies
// doesn't exhaust Cloud SQL's max_connections. Deliberately a plain Map +
// interval rather than pulling in an LRU dependency — tenant counts are
// small in this phase; a stricter cap can be added later without touching
// any call site.
const IDLE_EVICT_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const POOL_MAX_PER_TENANT = 5;

const pools = new Map(); // tenantDbName -> { pool, lastUsed }

function getTenantPool(tenantDbName) {
  if (!tenantDbName) {
    throw new Error('getTenantPool called with no tenant database name');
  }
  const entry = pools.get(tenantDbName);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.pool;
  }
  const pool = new Pool({ ...buildConnectionConfig(tenantDbName), max: POOL_MAX_PER_TENANT });
  pools.set(tenantDbName, { pool, lastUsed: Date.now() });
  return pool;
}

const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [tenantDbName, entry] of pools) {
    if (now - entry.lastUsed > IDLE_EVICT_MS) {
      pools.delete(tenantDbName);
      entry.pool.end().catch((err) => console.error(`Failed to close idle tenant pool for ${tenantDbName}:`, err.message));
    }
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

// Used by signup provisioning's failure-cleanup path: DROP DATABASE fails
// if any connection (including ours) is still open against it, so a pool
// created for a tenant that's about to be torn down must be closed first.
async function evictTenantPool(tenantDbName) {
  const entry = pools.get(tenantDbName);
  if (!entry) return;
  pools.delete(tenantDbName);
  await entry.pool.end().catch((err) => console.error(`Failed to close tenant pool for ${tenantDbName}:`, err.message));
}

module.exports = { getTenantPool, evictTenantPool };
