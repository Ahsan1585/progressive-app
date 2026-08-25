const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { protect } = require('../middleware/authMiddleware');
const { resolveTenantBySlug } = require('../middleware/tenantMiddleware');
const {
  submitTelepracticeSession,
  listTelepracticeRequests,
  resendTelepracticeSignatureRequest,
  getTelepracticeRequestDetail,
  confirmTelepracticeSession,
  getTelepracticeSignatureSummary,
  signTelepracticeSession,
} = require('../controllers/telepracticeSignatureController');

// Throttles the parent-facing, unauthenticated routes — same family as
// authRoutes.js's activateLimiter, since a bare 32-byte token is this
// endpoint's only protection against being probed. A read (GET) gets a
// slightly higher ceiling than the sign POST, since re-opening the email
// link to re-read the summary is normal, legitimate parent behavior.
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
// Defense-in-depth on top of the per-request 5-minute cooldown enforced in
// the controller — an authenticated, per-resource action, so this is a
// generous ceiling rather than the primary abuse guard.
const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resend requests. Please try again later.' },
});

// --- Authenticated (practitioner) ---
router.post('/', protect, submitTelepracticeSession);
router.get('/', protect, listTelepracticeRequests);
router.post('/:id/resend', resendLimiter, protect, resendTelepracticeSignatureRequest);
router.post('/:id/confirm', protect, confirmTelepracticeSession);
// Must come after the more specific practitioner routes above and before
// the public :companySlug/:token routes below, since a bare :id segment
// would otherwise never be reached (Express matches route order, and
// :companySlug/:token is a two-segment path so it can't collide with this
// single-segment one — kept here for readability, not correctness).
router.get('/:id', protect, getTelepracticeRequestDetail);

// --- Unauthenticated, tenant-scoped-by-slug (parent) — mirrors
// /:companySlug/activate/:token in authRoutes.js exactly. ---
router.get('/:companySlug/:token', signReadLimiter, resolveTenantBySlug, getTelepracticeSignatureSummary);
router.post('/:companySlug/:token/sign', signSubmitLimiter, resolveTenantBySlug, signTelepracticeSession);

module.exports = router;
