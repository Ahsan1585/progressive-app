const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');

const {
  provisionPractitioner,
  loginPractitioner,
  changeTemporaryPassword,
  getAllStaff,
  updateStaffRole,
  deleteStaffMember
} = require('../controllers/authController');

// ==========================================
// --- ADMIN ROUTES ---
// ==========================================

// CEO and Staff Director can register new accounts (backend enforces staff_director → practitioner only)
router.post('/register-practitioner', protect, requireRole(['ceo', 'staff_director']), provisionPractitioner);

// View all staff (CEO + Staff Director)
router.get('/staff', protect, requireRole(['ceo', 'staff_director']), getAllStaff);

// Change a staff member's role (CEO only)
router.patch('/staff/:id/role', protect, requireRole(['ceo']), updateStaffRole);

// Delete a staff member (CEO only)
router.delete('/staff/:id', protect, requireRole(['ceo']), deleteStaffMember);


// ==========================================
// --- PRACTITIONER ROUTES ---
// ==========================================

router.post('/login', loginPractitioner);

router.post('/change-password', protect, changeTemporaryPassword);

module.exports = router;
