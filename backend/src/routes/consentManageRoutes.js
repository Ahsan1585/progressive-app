const express = require('express');
const rateLimit = require('express-rate-limit');

const { resolveTenantBySlug } = require('../middleware/tenantMiddleware');
const { getManageLanding, viewConsent, withdrawConsent, downloadCopy } = require('../controllers/consentManageController');

const router = express.Router();

// Public, unauthenticated parent page for a signed consent. The token is the
// first factor and the child's date of birth the second (5-attempt lock in
// the controller); this throttles probing. Mounted at /api/consent-manage.
const manageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

router.get('/:companySlug/:token', manageLimiter, resolveTenantBySlug, getManageLanding);
router.post('/:companySlug/:token/view', manageLimiter, resolveTenantBySlug, viewConsent);
router.post('/:companySlug/:token/withdraw', manageLimiter, resolveTenantBySlug, withdrawConsent);
router.post('/:companySlug/:token/copy', manageLimiter, resolveTenantBySlug, downloadCopy);

module.exports = router;
