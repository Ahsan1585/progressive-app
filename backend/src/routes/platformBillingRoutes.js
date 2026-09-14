const express = require('express');
const router = express.Router();
const { listBillingOverview, getCompanyBillingDetail, suspendCompany, reactivateCompany } = require('../controllers/platformBillingController');
const { requirePlatformAdminAuth } = require('../middleware/platformAdminAuthMiddleware');

router.get('/overview', requirePlatformAdminAuth, listBillingOverview);
router.get('/:slug', requirePlatformAdminAuth, getCompanyBillingDetail);
router.post('/:slug/suspend', requirePlatformAdminAuth, suspendCompany);
router.post('/:slug/reactivate', requirePlatformAdminAuth, reactivateCompany);

module.exports = router;
