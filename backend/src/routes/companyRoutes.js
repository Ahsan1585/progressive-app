const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');
const {
  getCompanySettings,
  getCompanyBranding,
  updateCompanySettings,
  updateCompanyLogo,
  uploadComplianceDoc,
  getComplianceDocMapping,
  applyComplianceDocMapping,
  removeComplianceDoc,
  getComplianceDocDownloadUrl,
} = require('../controllers/companyController');

// Read: every admin-portal role — the sidebar shows the company logo/name
// regardless of which tab (Staff Directory/Master Reports/Billing) a user has access to.
const readGuard = [protect, requireRole(['ceo', 'staff_director', 'billing', 'account_specialist'])];
// Write: 'ceo' only (labeled "Admin" in the UI) — mirrors the Company
// Information tab itself being ceo-only.
const writeGuard = [protect, requireRole(['ceo'])];

router.get('/', ...readGuard, getCompanySettings);
// Any authenticated role (practitioners included) — just the display
// name/logo for the mobile app's Home header, not the full settings above.
router.get('/branding', protect, getCompanyBranding);
router.put('/', ...writeGuard, updateCompanySettings);
router.put('/logo', ...writeGuard, updateCompanyLogo);
router.put('/compliance-doc', ...writeGuard, uploadComplianceDoc);
router.get('/compliance-doc/mapping', ...writeGuard, getComplianceDocMapping);
router.post('/compliance-doc/apply-mapping', ...writeGuard, applyComplianceDocMapping);
router.delete('/compliance-doc', ...writeGuard, removeComplianceDoc);
// Read-guarded (not write) — Billing needs to download/view the reference
// document from the Compliance Analysis preview, not just Admin.
router.get('/compliance-doc/download', ...readGuard, getComplianceDocDownloadUrl);

module.exports = router;
