const express = require('express');
const rateLimit = require('express-rate-limit');

const { resolveTenantBySlug } = require('../middleware/tenantMiddleware');
const { getSharedDocumentLanding, downloadSharedDocument } = require('../controllers/sharedDocumentController');

const router = express.Router();

// Public, unauthenticated, token-gated — a bare 32-byte token is the only
// protection, so throttle probing the same way telepracticeSignatureRoutes
// does. Mounted at /api/shared-documents.
const sharedDocLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Tenant resolved from the company slug in the URL (no logged-in user),
// mirroring /api/telepractice-signatures/:companySlug/:token.
router.get('/:companySlug/:token', sharedDocLimiter, resolveTenantBySlug, getSharedDocumentLanding);
router.get('/:companySlug/:token/:docType', sharedDocLimiter, resolveTenantBySlug, downloadSharedDocument);

module.exports = router;
