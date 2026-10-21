const jwt = require('jsonwebtoken');
const { runWithTenant } = require('../config/tenantContext');
const { platformPool } = require('../config/platformDb');
const { getTenantPool } = require('../config/tenantPoolRegistry');
const { ensureDropdownOptionsCacheLoaded } = require('../constants/dropdownOptionsCache');

// Server-side idle timeout. The browser's own 15-minute idle lock stays the
// PRIMARY control: background polling (unread counts, /me, dashboards) is
// an authenticated request like any other and so counts as "activity" here,
// meaning an open-but-unattended tab never trips this limit. This is the
// backstop for an abandoned or stolen token that is no longer being driven
// by a live client at all. Activity is per-practitioner, not per-token, so a
// fresh login on one device also keeps that user's other tokens alive.
const DEFAULT_IDLE_MINUTES = 30;
const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;
const IDLE_EXPIRED_MESSAGE = 'Your session expired due to inactivity. Please log in again.';

function idleLimitMs() {
  const minutes = Number(process.env.SESSION_IDLE_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES) * 60 * 1000;
}

// NULL last_activity_at = never seen since the column was added; treat as
// active. The token's own iat also counts as activity, so a freshly minted
// token isn't rejected because of a stale timestamp from long ago. Shared
// with the socket handshake (realtime/handshake.js).
function isSessionIdleExpired(lastActivityAt, iat) {
  if (!lastActivityAt) return false;
  const lastActivityMs = new Date(lastActivityAt).getTime();
  const issuedAtMs = iat ? iat * 1000 : 0;
  return Date.now() - Math.max(lastActivityMs, issuedAtMs) > idleLimitMs();
}

// Fire-and-forget: a failed activity write must never fail the request.
function touchLastActivity(tenantPool, practitionerId) {
  try {
    Promise.resolve(tenantPool.query(
      `UPDATE practitioners SET last_activity_at = now()
       WHERE id = $1 AND (last_activity_at IS NULL OR last_activity_at < now() - interval '60 seconds')`,
      [practitionerId]
    )).catch((err) => console.error('last_activity_at update failed:', err.message));
  } catch (err) {
    console.error('last_activity_at update failed:', err.message);
  }
}

function extractBearer(req) {
  const authHeader = req.headers.authorization;
  return authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;
}

const protect = (req, res, next) => {
  // 1. Require a Bearer token with an actual value after it
  const token = extractBearer(req);

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
  // Purpose-scoped tokens (e.g. the 10-minute MFA challenge token) are only
  // valid on their own endpoints, never as a session.
  if (decoded.purpose !== undefined) {
    return res.status(401).json({ error: 'Not authorized, invalid token' });
  }
  req.practitioner = decoded;
  const tenantPool = getTenantPool(decoded.tenantDb);

  // 3. Trial/suspension gate AND the practitioner's own is_active flag,
  // both checked fresh on every request (cheap indexed lookups, run in
  // parallel) rather than trusting what a 24h JWT said at login time — a
  // trial that just ended, a suspended company, OR a practitioner who was
  // just deactivated (terminated, end of a sub-contracted assignment, a
  // child transitioning out of Part C) all take effect on this very
  // request instead of waiting for the token to expire. FERPA/IDEA Part C
  // §303.404 requires access revocation to be immediate, not "within 24
  // hours" — see the 2026-10-19 compliance audit. The ceo's own
  // subscription/payment routes stay reachable even past trial expiration
  // so there's always a way to add a payment method.
  Promise.all([
    platformPool.query('SELECT status, trial_ends_at, baa_accepted_at FROM companies WHERE slug = $1', [decoded.slug]),
    tenantPool.query('SELECT is_active, last_activity_at FROM practitioners WHERE id = $1', [decoded.practitionerId]),
  ])
    .then(([{ rows }, { rows: practitionerRows }]) => {
      // Fail closed: a missing row (deleted practitioner, stale JWT) is
      // treated the same as an explicitly deactivated one, not as "active."
      if (!practitionerRows[0] || practitionerRows[0].is_active === false) {
        return res.status(401).json({ error: 'Your account has been deactivated.' });
      }

      // NULL = never seen since the column was added; treat as active. The
      // token's own iat also counts as activity, so a freshly minted token
      // (login, or a support impersonation token, which never goes through
      // login) isn't rejected because of a stale timestamp from long ago.
      const lastActivity = practitionerRows[0].last_activity_at;
      const lastActivityMs = lastActivity ? new Date(lastActivity).getTime() : null;
      if (isSessionIdleExpired(lastActivity, decoded.iat)) {
        return res.status(401).json({ error: IDLE_EXPIRED_MESSAGE });
      }
      if (lastActivityMs === null || Date.now() - lastActivityMs > ACTIVITY_WRITE_THROTTLE_MS) {
        touchLastActivity(tenantPool, decoded.practitionerId);
      }

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

// --- MFA challenge tokens (minted by loginPractitioner, 10-minute TTL) ---
// They carry purpose: 'mfa' so `protect` refuses them as sessions, and a
// stage ('verify' | 'enroll') so each MFA endpoint accepts only the token it
// was meant for.
function decodeMfaToken(token, stage) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.purpose === 'mfa' && decoded.stage === stage && decoded.tenantDb ? decoded : null;
  } catch {
    return null;
  }
}

function enterMfaChallenge(req, decoded, next) {
  req.mfaChallenge = decoded;
  req.practitioner = decoded;
  return runWithTenant(decoded.tenantDb, () => next());
}

const INVALID_MFA_TOKEN = { error: 'Your verification session expired. Please log in again.' };

// POST /mfa/verify: the token arrives in the body ({ mfaToken, code }), or
// as a Bearer header for clients that prefer that.
const requireMfaChallenge = (stage) => (req, res, next) => {
  const decoded = decodeMfaToken(req.body?.mfaToken || extractBearer(req), stage);
  if (!decoded) return res.status(401).json(INVALID_MFA_TOKEN);
  return enterMfaChallenge(req, decoded, next);
};

// POST /mfa/setup and /mfa/enable: a real session (full `protect` checks),
// or an enroll-stage mfaToken for a user the company is forcing to enroll.
const protectSessionOrMfaToken = (req, res, next) => {
  const token = extractBearer(req);
  let unverified = null;
  try {
    unverified = token ? jwt.decode(token) : null;
  } catch {
    unverified = null;
  }
  if (unverified && unverified.purpose === 'mfa') {
    const decoded = decodeMfaToken(token, 'enroll');
    if (!decoded) return res.status(401).json(INVALID_MFA_TOKEN);
    return enterMfaChallenge(req, decoded, next);
  }
  return protect(req, res, next);
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

module.exports = { protect, isSessionIdleExpired, requireMfaChallenge, protectSessionOrMfaToken, requireRole, loadPermissions, requirePermission, requireAnyPermission, requireStaffEditOrSelf, requireOfficeStaff, requirePlatformSupportOnly };
