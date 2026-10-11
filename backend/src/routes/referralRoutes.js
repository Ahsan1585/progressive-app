const express = require('express');
const router = express.Router();
const { protect, loadPermissions, requireRole } = require('../middleware/authMiddleware');
const { getReferrals } = require('../controllers/referralController');

const independentGuard = [protect, loadPermissions, requireRole(['independent_practitioner'])];

router.get('/', ...independentGuard, getReferrals);

module.exports = router;
