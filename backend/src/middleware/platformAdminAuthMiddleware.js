const jwt = require('jsonwebtoken');
const { platformPool } = require('../config/platformDb');

// Gate for every /api/platform/* route EXCEPT /api/platform/auth/* (login,
// bootstrap), which must stay public. This is a deliberately different
// principal type from a tenant session's `protect` (authMiddleware.js):
// a platform-admin JWT is { platformAdminId, email, type: 'platform_admin' }
// — no role/slug/tenantDb. The `type` claim is the hard boundary that keeps
// the two token kinds from being replayed against each other's routes: a
// tenant JWT has no `type` field and is rejected here; a platform-admin JWT
// has no `slug`/`tenantDb` and would find no matching company if replayed
// against a tenant route guarded by `protect`.
const requirePlatformAdminAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: 'Not authorized, no token provided' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Not authorized, invalid token' });
  }

  if (decoded.type !== 'platform_admin') {
    return res.status(401).json({ error: 'Not authorized' });
  }

  try {
    // Fresh is_active re-check on every request, same reasoning as the
    // tenant `protect` middleware's fresh company-status check — a
    // deactivated platform admin's outstanding token stops working
    // immediately instead of waiting up to 12h for it to expire.
    const { rows } = await platformPool.query(
      'SELECT is_active FROM platform_admins WHERE id = $1',
      [decoded.platformAdminId]
    );
    if (!rows[0] || !rows[0].is_active) {
      return res.status(401).json({ error: 'Not authorized' });
    }
  } catch (err) {
    return next(err);
  }

  req.platformAdmin = decoded;
  next();
};

module.exports = { requirePlatformAdminAuth };
