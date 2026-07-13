const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');
const {
  generateMasterReport,
  getPendingReports,
  getAuditLogs,
  generateAuditNJEIS,
  generateAuditReportPDF,
  generateAuditReportExcel,
  issueInvoiceOverride
} = require('../controllers/reportController');

const ceoGuard = [protect, requireRole(['ceo'])];

router.post('/generate',           ...ceoGuard, generateMasterReport);
router.get('/pending',             ...ceoGuard, getPendingReports);
router.get('/audit-logs',          ...ceoGuard, getAuditLogs);
router.post('/audit-njeis',        ...ceoGuard, generateAuditNJEIS);
router.post('/audit-report-pdf',   ...ceoGuard, generateAuditReportPDF);
router.post('/audit-report-excel', ...ceoGuard, generateAuditReportExcel);
router.post('/issue-override',     ...ceoGuard, issueInvoiceOverride);

module.exports = router;
