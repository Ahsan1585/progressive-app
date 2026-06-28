const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
  let token;

  // 1. Check if the request header contains a Bearer token
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // 2. Extract the token from the "Bearer <token>" string
      token = req.headers.authorization.split(' ')[1];

      // 3. Verify the token using your secret key
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 4. Attach the decoded practitioner data (id, email) to the request object
      // This allows your controllers to know exactly WHO is making the request
      req.practitioner = decoded;

      // 5. Token is valid, move on to the actual route controller
      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      res.status(401).json({ error: 'Not authorized, invalid token' });
    }
  }

  // 6. If no token was provided at all
  if (!token) {
    res.status(401).json({ error: 'Not authorized, no token provided' });
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