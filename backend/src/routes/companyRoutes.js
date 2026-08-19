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
  refreshComplianceDocAnalysis,
  getComplianceDocDownloadUrl,
  downloadComplianceMonthData,
  deleteComplianceMonthData,
} = require('../controllers/companyController');

// Read: every admin-portal role — the sidebar shows the company logo/name
// regardless of which tab (Staff Directory/Master Reports/Billing) a user has access to.
const readGuard = [protect, loadPermissions, requireOfficeStaff];
// Write: 'ceo' only (labeled "Admin" in the UI) — mirrors the Company
// Information tab itself being ceo-only.
const brandingWriteGuard = [protect, requireRole(['ceo'])]; // PUT /, PUT /logo — stays Admin-exclusive per spec
const complianceDocGuard = [protect, loadPermissions, requirePermission('company_info_compliance_doc')]; // PUT /compliance-doc, GET /compliance-doc/mapping, POST /compliance-doc/apply-mapping, POST /compliance-doc/refresh-analysis, DELETE /compliance-doc

router.get('/', ...readGuard, getCompanySettings);
// Any authenticated role (practitioners included) — just the display
// name/logo for the mobile app's Home header, not the full settings above.
router.get('/branding', protect, getCompanyBranding);
router.put('/', ...brandingWriteGuard, updateCompanySettings);
router.put('/logo', ...brandingWriteGuard, updateCompanyLogo);
router.put('/compliance-doc', ...complianceDocGuard, uploadComplianceDoc);
router.get('/compliance-doc/mapping', ...complianceDocGuard, getComplianceDocMapping);
router.post('/compliance-doc/apply-mapping', ...complianceDocGuard, applyComplianceDocMapping);
router.post('/compliance-doc/refresh-analysis', ...complianceDocGuard, refreshComplianceDocAnalysis);
router.delete('/compliance-doc', ...complianceDocGuard, removeComplianceDoc);
// Read-guarded (not write) — Billing needs to download/view the reference
// document from the Compliance Analysis preview, not just Admin.
router.get('/compliance-doc/download', ...readGuard, getComplianceDocDownloadUrl);
// Per-month export of what's currently on file (compliance_state_logs), not
// the raw uploaded file — same read-level access as the raw-file download above.
router.get('/compliance-doc/month-data', ...readGuard, downloadComplianceMonthData);
// Deletes just one month's rows from the "Data currently on file" table —
// same write-level access as the full Remove above, since this is
// destructive too, just narrower in scope.
router.delete('/compliance-doc/month-data/:month', ...complianceDocGuard, deleteComplianceMonthData);

module.exports = router;
