const express = require('express');
const rateLimit = require('express-rate-limit');

const { resolveTenantBySlug } = require('../middleware/tenantMiddleware');
const { getReleaseLanding, requestCode, downloadRelease } = require('../controllers/recordsReleaseController');

const router = express.Router();

// Public recipient gateway for "Send records". The token is the first factor
// and the emailed code the second; this throttles probing of both. Mounted at
// /api/released-records.
const releaseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

router.get('/:companySlug/:token', releaseLimiter, resolveTenantBySlug, getReleaseLanding);
router.post('/:companySlug/:token/code', releaseLimiter, resolveTenantBySlug, requestCode);
router.post('/:companySlug/:token/download', releaseLimiter, resolveTenantBySlug, downloadRelease);

module.exports = router;
