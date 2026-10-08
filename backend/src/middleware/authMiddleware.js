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
      // An independent practitioner pays their own subscription directly
      // (no office ceo to do it for them), so they need the same lapsed-
      // trial escape hatch a ceo gets — otherwise a lapsed independent
      // practitioner is permanently locked out with no way to add a
      // payment method and recover the account.
      const ceoException = ['ceo', 'independent_practitioner'].includes(decoded.role) && isSubscriptionRoute;
      // Every role needs these two reachable regardless of trial/suspension
      // status, same reasoning as the BAA exemption below: the frontend
      // can't render the right blocking screen (or the sidebar/permissions
      // that survive it) if the very call that reports the block also gets
      // blocked itself.
      const isMeOrStatusRoute = req.originalUrl.startsWith('/api/auth/me') || req.originalUrl.startsWith('/api/auth/company-status');
      // A platform-admin-minted impersonation session (Izaya Support) always
      // gets past a lapsed trial/suspension — this is about helping an
      // already-BAA-signed customer whose billing lapsed, unrelated to the
      // BAA gate below (which is NOT bypassed — see impersonateCompany in
      // platformProvisioningController.js for that boundary).
      const isImpersonating = !!decoded.impersonation;

      if ((trialExpired || isSuspended) && !ceoException && !isMeOrStatusRoute && !isImpersonating) {
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
      // right blocking screen instead of a bare error). `/api/auth/me` is
      // exempted for the same reason isMeOrStatusRoute exempts it from the
      // trial/suspension gate above: it carries no PHI, and AdminDashboard's
      // sidebar/tab visibility depends on it succeeding even while BaaGate
      // is blocking everything else — without this, a first-time user's `me`
      // gets stuck at a zero-permissions fallback with no re-fetch trigger,
      // showing an empty sidebar even after accepting the BAA.
      const isBaaExemptRoute = req.originalUrl.startsWith('/api/auth/accept-baa')
        || req.originalUrl.startsWith('/api/auth/company-status')
        || req.originalUrl.startsWith('/api/auth/me');
      if (!company.baa_accepted_at && !isBaaExemptRoute) {
        // An independent practitioner has no administrator to wait on —
        // they accept their own BAA directly, same as a ceo does.
        return res.status(403).json({
          error: ['ceo', 'independent_practitioner'].includes(decoded.role)
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

const { pool } = require('../config/db');

const loadPermissions = (req, res, next) => {
  if (req.practitioner.role === 'ceo') {
    req.isAdmin = true;
    req.permissions = new Set();
    return next();
  }
  // An independent practitioner is CEO of their own single-seat company,
  // but — unlike a real tenant 'ceo' — has no office staff, no other
  // practitioners, and no company to run audits/reports/compliance docs
  // for. Granting req.isAdmin = true here (as a prior version of this code
  // did) was a real bug: requirePermission/requireAnyPermission both
  // short-circuit on isAdmin, so it silently passed every tenant-admin-only
  // check too — Staff Directory, Master Reports/audit exports, compliance
  // docs, audit logs, and the office billing-review tabs (Pending/Completed
  // Bills) — none of which apply to or should be reachable by this role.
  // Their own real workflows (self-certified SEVF generation, etc.) are
  // already gated separately via requireRole(['independent_practitioner'])
  // (see billingRoutes.js's independentGuard), not through this permission
  // system at all. Only the two permission keys this role's own UI actually
  // calls through requirePermission — self-service dropdown/vocabulary
  // config, and their own subscription/billing/payment-method management —
  // are granted here, explicitly, rather than via a blanket admin bypass.
  if (req.practitioner.role === 'independent_practitioner') {
    req.isAdmin = false;
    req.permissions = new Set(['company_info_dropdown_options', 'subscription_billing']);
    return next();
  }
  if (req.practitioner.role === 'practitioner') {
    req.isAdmin = false;
    req.permissions = new Set();
    return next();
  }
  pool
    .query(
      `SELECT r.is_system, COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS keys
       FROM practitioners p
       JOIN roles r ON r.id = p.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE p.id = $1
       GROUP BY r.is_system`,
      [req.practitioner.practitionerId]
    )
    .then(({ rows }) => {
      const row = rows[0];
      req.isAdmin = Boolean(row?.is_system);
      req.permissions = new Set(row?.keys || []);
      next();
    })
    .catch(next);
};

const requirePermission = (key) => (req, res, next) => {
  if (req.isAdmin || req.permissions?.has(key)) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
};

// Passes if the caller holds ANY one of the given keys — e.g. GET /staff is
// useful to both a general staff_directory_view holder and a role scoped
// down to just practitioner_manage (who still needs to see the list to act
// on it, but shouldn't need the broader view permission granted too).
const requireAnyPermission = (...keys) => (req, res, next) => {
  if (req.isAdmin || keys.some((key) => req.permissions?.has(key))) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
};

// PATCH /api/auth/staff/:id needs to stay reachable by an independent
// practitioner editing their OWN row (EditWorkDetails.tsx, mobile) even
// though they no longer hold staff_directory_edit (see loadPermissions'
// independent_practitioner branch above — that permission is deliberately
// NOT granted to this role, since it would also let them edit any OTHER
// practitioner's profile). Self-edit is still safe without that permission
// because updateStaffProfile only ever lets a non-admin caller touch
// Practitioner-role targets, and here the "target" IS the caller.
const requireStaffEditOrSelf = (req, res, next) => {
  if (String(req.params.id) === String(req.practitioner?.practitionerId)) {
    return next();
  }
  return requirePermission('staff_directory_edit')(req, res, next);
};

const requireOfficeStaff = (req, res, next) => {
  // An independent practitioner has no office staff — their single-seat
  // company has nobody to be "the office side" of anything office-staff-
  // gated (e.g. messaging), so they're excluded here exactly like a
  // regular practitioner is.
  if (['practitioner', 'independent_practitioner'].includes(req.practitioner?.role)) {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  next();
};

// Bulk practitioner import (Excel upload) is platform-admin-support-only —
// removed from every tenant's own Staff Directory UI regardless of
// permissions (see RegisterPractitionerForm.jsx), and enforced here too as
// defense-in-depth so a real admin/staff account can't reach it by calling
// the API directly. `isPlatformSupport` rides on the JWT from the moment an
// impersonation session is minted (platformProvisioningController.js) — no
// extra DB round-trip needed.
const requirePlatformSupportOnly = (req, res, next) => {
  if (!req.practitioner?.isPlatformSupport) {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  next();
};

const requireRole = (allowedRoles) => (req, res, next) => {
  const userRole = req.practitioner?.role;
  if (!userRole || !allowedRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  next();
};

module.exports = { protect, requireRole, loadPermissions, requirePermission, requireAnyPermission, requireStaffEditOrSelf, requireOfficeStaff, requirePlatformSupportOnly };
