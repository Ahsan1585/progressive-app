const express = require('express');
const router = express.Router();
const { listCompanies, listPromoCodes, createPromoCode, deactivatePromoCode, setTrialEndDate } = require('../controllers/platformAdminController');

// Not a real admin auth system for this phase — a bare shared-secret
// header, intentionally unpolished (superseded by Phase 3's setup
// dashboard). See the multi-tenant-foundation plan, section F.
function requirePlatformAdminKey(req, res, next) {
  const expected = process.env.PLATFORM_ADMIN_KEY;
  if (!expected || req.headers['x-platform-admin-key'] !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.get('/companies', requirePlatformAdminKey, listCompanies);
router.post('/companies/:slug/trial-end', requirePlatformAdminKey, setTrialEndDate);
router.get('/promo-codes', requirePlatformAdminKey, listPromoCodes);
router.post('/promo-codes', requirePlatformAdminKey, createPromoCode);
router.post('/promo-codes/:id/deactivate', requirePlatformAdminKey, deactivatePromoCode);

module.exports = router;
