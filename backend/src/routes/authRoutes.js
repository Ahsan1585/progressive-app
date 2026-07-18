const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { protect, requireRole } = require('../middleware/authMiddleware');

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
  loginPractitioner,
  changeTemporaryPassword,
  forgotPassword,
  resetPassword,
  getAllStaff,
  updateStaffProfile,
  updateStaffRole,
  deleteStaffMember,
  reactivateStaffMember
} = require('../controllers/authController');

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


// ==========================================
// --- PRACTITIONER ROUTES ---
// ==========================================

router.post('/login', loginLimiter, loginPractitioner);

router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPassword);

router.post('/change-password', protect, changeTemporaryPassword);

module.exports = router;
