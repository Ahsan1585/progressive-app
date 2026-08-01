const jwt = require('jsonwebtoken');
const { runWithTenant } = require('../config/tenantContext');
const { platformPool } = require('../config/platformDb');
const { ensureDropdownOptionsCacheLoaded } = require('../constants/dropdownOptionsCache');

const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // 1. Require a Bearer token with an actual value after it
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Not authorized, no token provided' });
  }

  // 2. Verify the token
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    // Do not log token contents or verification error details
    return res.status(401).json({ error: 'Not authorized, invalid token' });
  }
  req.practitioner = decoded;

  // 3. Trial/suspension gate, checked fresh on every request (one cheap
  // indexed lookup on a tiny table) rather than trusting the tenantDb/slug
  // baked into a 24h JWT — a trial that just ended (or a company that gets
  // suspended) takes effect immediately instead of waiting for the token to
  // expire. The ceo's own subscription/payment routes stay reachable even
  // past trial expiration so there's always a way to add a payment method.
  platformPool
    .query('SELECT status, trial_ends_at, baa_accepted_at FROM companies WHERE slug = $1', [decoded.slug])
    .then(({ rows }) => {
      const company = rows[0];
      if (!company || company.status === 'cancelled') {
        return res.status(403).json({ error: "This company's account is no longer active." });
      }

      const trialExpired = company.status === 'trial' && company.trial_ends_at && new Date(company.trial_ends_at) < new Date();
      const isSuspended = company.status === 'suspended';
      const isSubscriptionRoute = req.originalUrl.startsWith('/api/subscription');
      const ceoException = decoded.role === 'ceo' && isSubscriptionRoute;

      if ((trialExpired || isSuspended) && !ceoException) {
        return res.status(402).json({
          error: trialExpired
            ? 'Your free trial has ended — add a payment method to continue.'
            : "This company's account is suspended.",
        });
      }

      // 3b. Business Associate Agreement gate — a company can be flagged
      // (or re-flagged, e.g. an agreement lapsing/being superseded) as not
      // having a BAA on file, which blocks all PHI-touching routes until a
      // ceo accepts it. `/api/auth/accept-baa` and `/api/auth/company-status`
      // stay reachable regardless (a ceo needs the first to clear the gate,
      // and every role needs the second so the frontend can render the
      // right blocking screen instead of a bare error).
      const isBaaExemptRoute = req.originalUrl.startsWith('/api/auth/accept-baa') || req.originalUrl.startsWith('/api/auth/company-status');
      if (!company.baa_accepted_at && !isBaaExemptRoute) {
        return res.status(403).json({
          error: decoded.role === 'ceo'
            ? 'A Business Associate Agreement must be accepted before continuing.'
            : "Your administrator needs to accept Izaya's Business Associate Agreement before you can continue.",
          code: 'BAA_REQUIRED',
        });
      }

      // 4. Everything downstream (route handlers, all ~15 controllers'
      // `pool.query(...)` calls via db.js's tenant-aware Proxy) runs inside
      // this AsyncLocalStorage context, so it transparently talks to the
      // right tenant database — no per-route changes needed. The dropdown
      // cache is primed here too (synchronous reads elsewhere, e.g. in
      // njeis.js, can't lazily await a load themselves).
      return runWithTenant(decoded.tenantDb, () =>
        ensureDropdownOptionsCacheLoaded(decoded.tenantDb).then(next)
      );
    })
    .catch(next);
};

const requireRole = (allowedRoles) => (req, res, next) => {
  const userRole = req.practitioner?.role;
  if (!userRole || !allowedRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  next();
};

module.exports = { protect, requireRole };
