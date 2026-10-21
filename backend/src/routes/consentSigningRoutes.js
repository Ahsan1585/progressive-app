const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { resolveTenantBySlug } = require('../middleware/tenantMiddleware');
const {
  getConsentSigningState,
  verifyConsentSigningIdentity,
  signConsent,
} = require('../controllers/consentSigningController');

// Mounted at /api/consent-signing. Public, unauthenticated, tenant resolved
// from the slug — same shape and per-IP limits as the telepractice parent
// signing routes (telepracticeSignatureRoutes.js): a bare 32-byte token is
// the only protection, so it gets throttled, on top of the controller's
// 5-attempts-per-token DOB lock.
const signReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});
const signSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

router.get('/:companySlug/:token', signReadLimiter, resolveTenantBySlug, getConsentSigningState);
router.post('/:companySlug/:token/verify', signSubmitLimiter, resolveTenantBySlug, verifyConsentSigningIdentity);
router.post('/:companySlug/:token/sign', signSubmitLimiter, resolveTenantBySlug, signConsent);

module.exports = router;
