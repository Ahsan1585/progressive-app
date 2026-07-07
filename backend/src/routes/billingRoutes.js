const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');

const {
  getPendingLogs,
  generateNJEISForms,
  generateFinancialInvoice,
  getInvoiceHistory,
  getInvoiceDownloadUrl,
  getPractitionerLogs,
  updateLogStatus,
  rejectLog,
  getVaultLogs,
  getBillingBatches,
  revertBillingBatch
} = require('../controllers/billingController');

const billingGuard = [protect, requireRole(['ceo', 'billing'])];

router.get('/pending-logs',      ...billingGuard, getPendingLogs);
router.get('/practitioner-logs', ...billingGuard, getPractitionerLogs);
router.patch('/log-status',      ...billingGuard, updateLogStatus);
router.post('/reject-log',       ...billingGuard, rejectLog);
router.post('/generate-njeis',   ...billingGuard, generateNJEISForms);
router.post('/generate-invoice', ...billingGuard, generateFinancialInvoice);
router.get('/history',           ...billingGuard, getInvoiceHistory);
router.get('/download',          ...billingGuard, getInvoiceDownloadUrl);
router.get('/vault-logs',        ...billingGuard, getVaultLogs);
router.get('/batches',           ...billingGuard, getBillingBatches);
router.post('/revert-batch',     ...billingGuard, revertBillingBatch);

module.exports = router;
