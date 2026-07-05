const jwt = require('jsonwebtoken');

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
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.practitioner = decoded;
    return next();
  } catch {
    // Do not log token contents or verification error details
    return res.status(401).json({ error: 'Not authorized, invalid token' });
  }
};

const requireRole = (allowedRoles) => (req, res, next) => {
  const userRole = req.practitioner?.role;
  if (!userRole || !allowedRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  next();
};

module.exports = { protect, requireRole };