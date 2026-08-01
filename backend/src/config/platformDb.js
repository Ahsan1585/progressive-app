const { Pool, types } = require('pg');
const { buildConnectionConfig } = require('./dbConnectionConfig');

types.setTypeParser(types.builtins.DATE, (val) => val);

// Always-on pool pointed permanently at izaya_platform — Izaya's own tenant
// registry (see backend/db/platform-schema.sql). Entirely outside the
// tenant-proxy/AsyncLocalStorage mechanism in tenantContext.js/db.js: this
// is platform metadata, never a customer's business data, so it never
// participates in per-request tenant switching.
const PLATFORM_DB_NAME = process.env.PLATFORM_DB_NAME || 'izaya_platform';
const platformPool = new Pool(buildConnectionConfig(PLATFORM_DB_NAME));

module.exports = { platformPool, PLATFORM_DB_NAME };
