const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');
const { getCompanySettings, updateCompanySettings, updateCompanyLogo } = require('../controllers/companyController');

// Read: every admin-portal role — the sidebar shows the company logo/name
// regardless of which tab (Staff Directory/Master Reports/Billing) a user has access to.
const readGuard = [protect, requireRole(['ceo', 'staff_director', 'billing', 'account_specialist'])];
// Write: 'ceo' only (labeled "Admin" in the UI) — mirrors the Company
// Information tab itself being ceo-only.
const writeGuard = [protect, requireRole(['ceo'])];

router.get('/', ...readGuard, getCompanySettings);
router.put('/', ...writeGuard, updateCompanySettings);
router.put('/logo', ...writeGuard, updateCompanyLogo);

module.exports = router;
