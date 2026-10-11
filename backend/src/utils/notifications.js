const { pool } = require('../config/db');

// Writes one row into a tenant's own `notifications` table (see
// add_referral_program.sql). Independent-practitioner-only feature; never
// called for a tenant-company practitioner's tenant database.
//
// `targetPool` defaults to the AsyncLocalStorage-backed `pool` proxy (the
// right choice from inside a runWithTenant(...) context, e.g. the Stripe
// webhook or billing cron — see subscriptionController.js). It can be
// passed explicitly for the one call site that writes a notification
// BEFORE any tenant context exists: independentSignupController.js's
// confirmIndependentSignup, which talks to a brand-new tenant via the raw
// `tenantPool` returned by provisionTenantDatabase, not via runWithTenant —
// calling the default `pool` there would throw ("No tenant context set").
async function writeNotification({ type, title, body }, targetPool = pool) {
  await targetPool.query(
    `INSERT INTO notifications (type, title, body) VALUES ($1, $2, $3)`,
    [type, title, body]
  );
}

module.exports = { writeNotification };
