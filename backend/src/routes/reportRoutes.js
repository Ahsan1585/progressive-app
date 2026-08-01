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
// Reading audit logs is its own permission — keep this in step with
// auditLogRoutes.js, which guards the equivalent endpoint with 'audit_logs'.
const auditLogGuard = [protect, loadPermissions, requirePermission('audit_logs')];

router.post('/generate',           ...ceoGuard, generateMasterReport);
router.get('/pending',             ...ceoGuard, getPendingReports);
router.get('/audit-logs',          ...auditLogGuard, getAuditLogs);
router.get('/patients',            ...ceoGuard, getAllPatients);
router.post('/audit-njeis',        ...ceoGuard, generateAuditNJEIS);
router.post('/audit-report-pdf',   ...ceoGuard, generateAuditReportPDF);
router.post('/audit-report-excel', ...ceoGuard, generateAuditReportExcel);
router.post('/issue-override',     ...ceoGuard, issueInvoiceOverride);

module.exports = router;
