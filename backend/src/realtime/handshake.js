const jwt = require('jsonwebtoken');
const { platformPool } = require('../config/platformDb');
const { runWithTenant } = require('../config/tenantContext');
const { pool } = require('../config/db');

// Socket.io connection gate. Mirrors the REST `protect` middleware
// (authMiddleware.js): verify the JWT, re-check the company's status against
// the platform registry, then resolve the connecting user's identity from
// their tenant's own database.
//
// TENANT SAFETY: `tenantDb` is taken ONLY from the verified JWT and frozen
// onto `socket.data` here. Nothing the client sends over the wire after
// this point can change it — every later handler derives rooms and scopes
// DB queries from `socket.data.tenantDb`, never from event payloads.
async function authHandshake(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token || typeof token !== 'string') {
      return next(new Error('unauthorized'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return next(new Error('unauthorized'));
    }
    const { practitionerId, role, slug, tenantDb } = decoded;
    if (!practitionerId || !role || !slug || !tenantDb) {
      return next(new Error('unauthorized'));
    }

    // Company-status gate — same checks REST does on every request, run once
    // here at connect. (Trial can lapse mid-connection; the periodic sweep
    // in index.js and the re-check on reconnect bound the staleness.)
    const { rows } = await platformPool.query(
      'SELECT status, trial_ends_at, baa_accepted_at FROM companies WHERE slug = $1',
      [slug]
    );
    const company = rows[0];
    if (!company || company.status === 'cancelled') return next(new Error('unauthorized'));
    const trialExpired =
      company.status === 'trial' && company.trial_ends_at && new Date(company.trial_ends_at) < new Date();
    if (trialExpired || company.status === 'suspended') return next(new Error('unauthorized'));
    if (!company.baa_accepted_at) return next(new Error('unauthorized'));

    // Resolve the connecting user's display name from THEIR tenant DB, and
    // confirm the account is still active. Scoped by runWithTenant so the
    // tenant-proxy `pool` hits the right database.
    const person = await runWithTenant(tenantDb, async () => {
      const r = await pool.query(
        'SELECT first_name, last_name, is_active FROM practitioners WHERE id = $1',
        [practitionerId]
      );
      return r.rows[0];
    });
    if (!person || person.is_active === false) return next(new Error('unauthorized'));

    socket.data = {
      staffId: practitionerId,
      role,
      slug,
      tenantDb,
      name: `${person.first_name} ${person.last_name}`.trim(),
      isOffice: role !== 'practitioner',
      tokenExp: decoded.exp || null, // seconds since epoch; used by the expiry sweep
    };
    return next();
  } catch (err) {
    console.error('socket authHandshake error:', err);
    return next(new Error('unauthorized'));
  }
}

module.exports = { authHandshake };
