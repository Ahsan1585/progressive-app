require('dotenv').config();
const { getCurrentTenantDb } = require('./tenantContext');
const { getTenantPool } = require('./tenantPoolRegistry');

// `pool` used to be a single module-level pg.Pool shared by the whole
// (single-tenant) app. Now every controller still does
// `const { pool } = require('../config/db')` and calls `pool.query(...)`/
// `pool.connect()` exactly as before — but this Proxy resolves, on every
// single property/method access, whichever tenant database is active for
// the current request (set by tenant-resolution middleware via
// tenantContext.js's AsyncLocalStorage), and forwards to that tenant's real
// pg.Pool. This is what makes ~15 existing controllers tenant-aware with
// zero changes to their query call sites, including the one pool.connect()
// transaction block in companyController.js — the returned client is a
// real PoolClient bound to the correct tenant's real Pool.
const pool = new Proxy(
  {},
  {
    get(_target, prop) {
      const real = getTenantPool(getCurrentTenantDb());
      const val = real[prop];
      return typeof val === 'function' ? val.bind(real) : val;
    },
  }
);

module.exports = { pool };
