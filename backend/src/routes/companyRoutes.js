const express = require('express');
const router = express.Router();

const { protect, requireRole, loadPermissions, requirePermission, requireOfficeStaff } = require('../middleware/authMiddleware');
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
const readGuard = [protect, loadPermissions, requireOfficeStaff];
// Write: 'ceo' only (labeled "Admin" in the UI) — mirrors the Company
// Information tab itself being ceo-only.
const brandingWriteGuard = [protect, requireRole(['ceo'])]; // PUT /, PUT /logo — stays Admin-exclusive per spec
const complianceDocGuard = [protect, loadPermissions, requirePermission('company_info_compliance_doc')]; // PUT /compliance-doc, GET /compliance-doc/mapping, POST /compliance-doc/apply-mapping, DELETE /compliance-doc

router.get('/', ...readGuard, getCompanySettings);
// Any authenticated role (practitioners included) — just the display
// name/logo for the mobile app's Home header, not the full settings above.
router.get('/branding', protect, getCompanyBranding);
router.put('/', ...brandingWriteGuard, updateCompanySettings);
router.put('/logo', ...brandingWriteGuard, updateCompanyLogo);
router.put('/compliance-doc', ...complianceDocGuard, uploadComplianceDoc);
router.get('/compliance-doc/mapping', ...complianceDocGuard, getComplianceDocMapping);
router.post('/compliance-doc/apply-mapping', ...complianceDocGuard, applyComplianceDocMapping);
router.delete('/compliance-doc', ...complianceDocGuard, removeComplianceDoc);
// Read-guarded (not write) — Billing needs to download/view the reference
// document from the Compliance Analysis preview, not just Admin.
router.get('/compliance-doc/download', ...readGuard, getComplianceDocDownloadUrl);

module.exports = router;
