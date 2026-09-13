const fs = require('fs');
const path = require('path');
const { getProvisioningPool } = require('../config/provisioningDb');
const { getTenantPool } = require('../config/tenantPoolRegistry');
const { applyMigrationsToPool } = require('../config/runMigrations');
const { PREBUILT_ROLE_NAMES } = require('../constants/permissions');

// The byte-identical portion of tenant creation shared by both provisioning
// paths — the customer self-signup flow (signupController.js's
// confirmSignup) and the platform-admin-triggered flow
// (platformProvisioningController.js's createCompany): create the database,
// apply the schema + every migration, seed the Admin + prebuilt roles.
//
// Deliberately does NOT seed company_settings or insert any practitioner
// rows — the two callers build different payloads for those (self-signup
// has one ceo password already in hand; platform-admin creates a hidden
// support account too) — so that part stays in each caller, right after
// this returns.
//
// Returns { tenantPool, adminRoleId } so the caller can keep going with the
// same pool/context. Throws on any failure — the caller is responsible for
// its own failure-cleanup (evictTenantPool + DROP DATABASE), since the
// error-handling/response shape differs per caller.
async function provisionTenantDatabase({ slug, tenantDbName }) {
  // CREATE DATABASE cannot run inside a transaction block — a plain,
  // autocommit query via the elevated, CREATEDB-only provisioning
  // connection (see provisioningDb.js; deliberately never the same
  // credential the everyday tenant pools use).
  await getProvisioningPool().query(`CREATE DATABASE "${tenantDbName}"`);

  const tenantPool = getTenantPool(tenantDbName);
  const schemaSql = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
  await tenantPool.query(schemaSql);
  await applyMigrationsToPool(tenantPool, slug);

  // Seed the Admin role + 4 prebuilt roles for this new tenant. The
  // migrations applied above (add_roles_permissions.sql) already seed
  // these same rows via `WHERE NOT EXISTS` guards, so this reuses those
  // same guards rather than bare INSERTs — otherwise this would throw a
  // duplicate-key error on every single provision.
  const { rows: adminRoleRows } = await tenantPool.query(
    `INSERT INTO roles (name, is_system) SELECT 'Admin', true WHERE NOT EXISTS (SELECT 1 FROM roles WHERE is_system = true) RETURNING id`
  );
  let adminRoleId = adminRoleRows[0]?.id;
  if (!adminRoleId) {
    const { rows } = await tenantPool.query('SELECT id FROM roles WHERE is_system = true');
    adminRoleId = rows[0].id;
  }
  for (const roleName of PREBUILT_ROLE_NAMES) {
    const { rows: existing } = await tenantPool.query('SELECT id FROM roles WHERE name = $1', [roleName]);
    if (existing[0]) continue;
    const { rows } = await tenantPool.query('INSERT INTO roles (name) VALUES ($1) RETURNING id', [roleName]);
    await tenantPool.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [rows[0].id, 'staff_directory_view']);
  }

  return { tenantPool, adminRoleId };
}

module.exports = { provisionTenantDatabase };
