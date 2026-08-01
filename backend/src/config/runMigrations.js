const fs = require('fs');
const path = require('path');
const { MIGRATIONS } = require('../../db/migrations');
const { platformPool } = require('./platformDb');
const { getTenantPool } = require('./tenantPoolRegistry');

// Every file listed in MIGRATIONS must be purely additive/idempotent (ADD
// COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, etc.) — this runs on
// every boot, against every tenant database, not just once.
async function applyMigrationsToPool(pool, label) {
  for (const file of MIGRATIONS) {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations', file), 'utf8');
    await pool.query(sql);
    console.log(`Migration applied to ${label}: ${file}`);
  }
}

// Loops over every non-cancelled company in the platform registry and
// applies the same fixed migration list to each one's tenant database.
// Requires izaya_platform (and its `companies` table, with at least the
// one row registered for the existing production tenant) to already exist
// before this boots — see the multi-tenant-foundation plan, section E,
// step 5, for the deploy-ordering requirement this implies.
async function runMigrations() {
  const { rows: companies } = await platformPool.query(
    "SELECT slug, tenant_db_name FROM companies WHERE status != 'cancelled'"
  );
  for (const { slug, tenant_db_name } of companies) {
    const tenantPool = getTenantPool(tenant_db_name);
    await applyMigrationsToPool(tenantPool, slug);
  }
}

module.exports = { runMigrations, applyMigrationsToPool };
