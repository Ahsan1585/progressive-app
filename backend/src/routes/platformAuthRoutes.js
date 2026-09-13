const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { bootstrapFirstAdmin, loginPlatformAdmin } = require('../controllers/platformAuthController');

// Same throttling posture as the tenant login limiter (authRoutes.js) —
// slow brute-force/credential-stuffing against platform-admin accounts,
// which have far broader reach than any single tenant account.
const platformLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Public — no requirePlatformAdminAuth. bootstrapFirstAdmin gates itself
// (403 once any platform_admins row exists; the PLATFORM_ADMIN_KEY header
// check only applies to that first, table-empty call).
router.post('/bootstrap', platformLoginLimiter, bootstrapFirstAdmin);
router.post('/login', platformLoginLimiter, loginPlatformAdmin);

module.exports = router;
