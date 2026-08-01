const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
const {
  generateMasterReport,
  getPendingReports,
  getAuditLogs,
  getAllPatients,
  generateAuditNJEIS,
  generateAuditReportPDF,
  generateAuditReportExcel,
  issueInvoiceOverride
} = require('../controllers/reportController');

const ceoGuard = [protect, loadPermissions, requirePermission('master_reports')];

router.post('/generate',           ...ceoGuard, generateMasterReport);
router.get('/pending',             ...ceoGuard, getPendingReports);
// Despite the name, this is the encounter-log query behind the Master Reports
// screen (assessments/practitioners), not the PHI access trail — that lives in
// auditLogController.js / auditLogRoutes.js and is gated on 'audit_logs'.
router.get('/audit-logs',          ...ceoGuard, getAuditLogs);
router.get('/patients',            ...ceoGuard, getAllPatients);
router.post('/audit-njeis',        ...ceoGuard, generateAuditNJEIS);
router.post('/audit-report-pdf',   ...ceoGuard, generateAuditReportPDF);
router.post('/audit-report-excel', ...ceoGuard, generateAuditReportExcel);
router.post('/issue-override',     ...ceoGuard, issueInvoiceOverride);

module.exports = router;
