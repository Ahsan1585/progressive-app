const express = require('express');
const router = express.Router();
const { protect, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
const { getDayOverview, getPipelineOverview, getReturnedLogs, getSessionDetail, getMonthOverview, getYearOverview, getAccountsPayable } = require('../controllers/dashboardController');

// Reuses the existing master_reports permission — same class of access as
// Master Reports (company-wide view, not a single practitioner's own
// data), rather than adding a new key to the fixed 14-key permission
// catalog (src/constants/permissions.js) for this first pass.
const dashboardGuard = [protect, loadPermissions, requirePermission('master_reports')];

router.get('/day', ...dashboardGuard, getDayOverview);
router.get('/pipeline', ...dashboardGuard, getPipelineOverview);
router.get('/returned-logs', ...dashboardGuard, getReturnedLogs);
router.get('/session-detail', ...dashboardGuard, getSessionDetail);
router.get('/month', ...dashboardGuard, getMonthOverview);
router.get('/year', ...dashboardGuard, getYearOverview);
router.get('/ap', ...dashboardGuard, getAccountsPayable);

module.exports = router;
