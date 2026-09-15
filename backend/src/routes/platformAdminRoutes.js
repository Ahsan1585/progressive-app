const express = require('express');
const router = express.Router();
const { listCompanies, listPromoCodes, createPromoCode, deactivatePromoCode, setTrialEndDate, getCompanyPricing, setCompanyPricing } = require('../controllers/platformAdminController');
const { createCompany, impersonateCompany, ensureSupportAccount, deleteCompanyData } = require('../controllers/platformProvisioningController');
const { listUnsubscribes } = require('../controllers/marketingController');
const { requirePlatformAdminAuth } = require('../middleware/platformAdminAuthMiddleware');

router.get('/companies', requirePlatformAdminAuth, listCompanies);
router.post('/companies', requirePlatformAdminAuth, createCompany);
router.post('/companies/:slug/trial-end', requirePlatformAdminAuth, setTrialEndDate);
router.get('/companies/:slug/pricing', requirePlatformAdminAuth, getCompanyPricing);
router.post('/companies/:slug/pricing', requirePlatformAdminAuth, setCompanyPricing);
router.post('/companies/:slug/impersonate', requirePlatformAdminAuth, impersonateCompany);
router.post('/companies/:slug/ensure-support-account', requirePlatformAdminAuth, ensureSupportAccount);
router.post('/companies/:slug/delete-data', requirePlatformAdminAuth, deleteCompanyData);
router.get('/promo-codes', requirePlatformAdminAuth, listPromoCodes);
router.post('/promo-codes', requirePlatformAdminAuth, createPromoCode);
router.post('/promo-codes/:id/deactivate', requirePlatformAdminAuth, deactivatePromoCode);
router.get('/marketing/unsubscribes', requirePlatformAdminAuth, listUnsubscribes);

module.exports = router;
