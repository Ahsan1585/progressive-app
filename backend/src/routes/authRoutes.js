const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { protect, requireRole } = require('../middleware/authMiddleware');
const { resolveTenantBySlug } = require('../middleware/tenantMiddleware');

// Throttle login attempts to slow brute-force / credential-stuffing (HIPAA §164.308(a)(5))
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Throttle reset-request emails so an attacker can't mail-bomb a practitioner's inbox
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

const {
  provisionPractitioner,
  activateAccount,
  getCompanyDisplayName,
  getCompanyStatus,
  acceptBaa,
  loginPractitioner,
  changeTemporaryPassword,
  forgotPassword,
  resetPassword,
  getAllStaff,
  updateStaffProfile,
  updateStaffRole,
  deleteStaffMember,
  reactivateStaffMember,
  reviewContactUpdate
} = require('../controllers/authController');

// Throttle account activation attempts the same way as login/reset —
// prevents brute-forcing an invite/activation token.
const activateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// ==========================================
// --- ADMIN ROUTES ---
// ==========================================

// CEO, Staff Director, and Account Specialist can register new accounts
// (backend enforces staff_director/account_specialist → practitioner only)
router.post('/register-practitioner', protect, requireRole(['ceo', 'staff_director', 'account_specialist']), provisionPractitioner);

// View all staff (CEO + Staff Director + Account Specialist)
router.get('/staff', protect, requireRole(['ceo', 'staff_director', 'account_specialist']), getAllStaff);

// Edit a staff member's profile (CEO + Staff Director + Account Specialist; controller restricts
// Staff Director/Account Specialist to Practitioner-role targets)
router.patch('/staff/:id', protect, requireRole(['ceo', 'staff_director', 'account_specialist']), updateStaffProfile);

// Change a staff member's role (CEO only)
router.patch('/staff/:id/role', protect, requireRole(['ceo']), updateStaffRole);

// Delete a staff member (CEO only)
router.delete('/staff/:id', protect, requireRole(['ceo']), deleteStaffMember);

// Reactivate a deactivated staff member (CEO only)
router.patch('/staff/:id/reactivate', protect, requireRole(['ceo']), reactivateStaffMember);

// Accept or reject a practitioner's self-submitted contact info change
// (CEO + Staff Director + Account Specialist — same tier as editing staff profiles)
router.post('/staff/:id/contact-request', protect, requireRole(['ceo', 'staff_director', 'account_specialist']), reviewContactUpdate);


// ==========================================
// --- PRACTITIONER ROUTES ---
// ==========================================

// All three of these are unauthenticated (no JWT exists yet) but tenant-
// scoped by company slug — resolveTenantBySlug reads req.body.slug and
// sets the AsyncLocalStorage tenant context before the controller runs.
router.post('/login', loginLimiter, resolveTenantBySlug, loginPractitioner);
router.post('/forgot-password', forgotPasswordLimiter, resolveTenantBySlug, forgotPassword);
router.post('/reset-password', resolveTenantBySlug, resetPassword);

// Invite-link account activation — tenant resolved from the URL's company
// slug segment instead of the request body, so the invitee never has to
// know or type a company code themselves.
router.post('/:companySlug/activate/:token', activateLimiter, resolveTenantBySlug, activateAccount);
router.get('/:companySlug/company-name', getCompanyDisplayName);

router.post('/change-password', protect, changeTemporaryPassword);
router.get('/company-status', protect, getCompanyStatus);
router.post('/accept-baa', protect, requireRole(['ceo']), acceptBaa);

module.exports = router;
