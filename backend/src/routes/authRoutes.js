const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { protect, requireRole, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
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
  resendInvite,
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
  reviewContactUpdate,
  getMe
} = require('../controllers/authController');

const {
  previewPractitionerImport,
  confirmPractitionerImport,
} = require('../controllers/practitionerImportController');

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

// Anyone with register_new_user can register new accounts
// (backend enforces non-admin/non-role-editors → practitioner only)
router.post('/register-practitioner', protect, loadPermissions, requirePermission('register_new_user'), provisionPractitioner);

// Resend an activation link for an account that hasn't activated yet
// (e.g. the original 7-day link expired) — same permission as inviting.
router.post('/staff/:id/resend-invite', protect, loadPermissions, requirePermission('register_new_user'), resendInvite);

// Staff Directory's bulk (Excel upload) practitioner registration —
// practitioner-only, same permission as the single-registration form.
// Preview parses the file and returns the auto-detected column mapping;
// Confirm re-parses with the reviewed mapping and creates every valid row.
router.post('/staff/bulk-import/preview', protect, loadPermissions, requirePermission('register_new_user'), previewPractitionerImport);
router.post('/staff/bulk-import/confirm', protect, loadPermissions, requirePermission('register_new_user'), confirmPractitionerImport);

// View all staff (staff_directory_view)
router.get('/staff', protect, loadPermissions, requirePermission('staff_directory_view'), getAllStaff);

// Edit a staff member's profile (staff_directory_edit; controller restricts
// non-role-editors to Practitioner-role targets)
router.patch('/staff/:id', protect, loadPermissions, requirePermission('staff_directory_edit'), updateStaffProfile);

// Change a staff member's role (staff_directory_edit_role)
router.patch('/staff/:id/role', protect, loadPermissions, requirePermission('staff_directory_edit_role'), updateStaffRole);

// Delete a staff member (staff_directory_edit_role)
router.delete('/staff/:id', protect, loadPermissions, requirePermission('staff_directory_edit_role'), deleteStaffMember);

// Reactivate a deactivated staff member (staff_directory_edit_role)
router.patch('/staff/:id/reactivate', protect, loadPermissions, requirePermission('staff_directory_edit_role'), reactivateStaffMember);

// Accept or reject a practitioner's self-submitted contact info change
// (staff_directory_edit — same tier as editing staff profiles)
router.post('/staff/:id/contact-request', protect, loadPermissions, requirePermission('staff_directory_edit'), reviewContactUpdate);


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
router.get('/me', protect, loadPermissions, getMe);
router.post('/accept-baa', protect, requireRole(['ceo']), acceptBaa);

module.exports = router;
