const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requireRole } = require('../middleware/authMiddleware');
const { getDashboardSummary, getMonthlyTrend, getByAgency } = require('../controllers/practitionerDashboardController');

// Independent-practitioner-only — mirrors billingRoutes.js's
// independentGuard exactly. Every tenant-company practitioner's logs are
// never priced in dollars at the practitioner level (that's billing's own
// office-review concern), so this whole surface is meaningless for any
// other role.
const independentGuard = [protect, loadPermissions, requireRole(['independent_practitioner'])];

router.get('/summary', ...independentGuard, getDashboardSummary);
router.get('/monthly-trend', ...independentGuard, getMonthlyTrend);
router.get('/by-agency', ...independentGuard, getByAgency);

module.exports = router;
