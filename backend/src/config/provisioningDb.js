const { Pool } = require('pg');
const { buildConnectionConfig } = require('./dbConnectionConfig');
const { PLATFORM_DB_NAME } = require('./platformDb');

// Connection used only to CREATE DATABASE for a newly signed-up company.
// Reuses the app's normal DB_USER/DB_PASSWORD credential (which has been
// granted the CREATEDB attribute — see the multi-tenant-foundation plan's
// deploy notes) rather than provisioning a wholly separate elevated role:
// CREATEDB is the only extra privilege this needs, and DB_USER already had
// to be trusted with full read/write on every tenant database it manages,
// so a second credential here would add configuration surface without a
// meaningful additional isolation boundary. Connects to izaya_platform
// (Postgres requires connecting to *some* database to issue CREATE
// DATABASE against a different one).
let provisioningPool = null;

function getProvisioningPool() {
  if (!provisioningPool) {
    provisioningPool = new Pool(buildConnectionConfig(PLATFORM_DB_NAME));
  }
  return provisioningPool;
}

module.exports = { getProvisioningPool };
