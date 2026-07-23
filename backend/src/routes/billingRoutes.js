const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');

const {
  getPendingLogs,
  generateNJEISForms,
  generateFinancialInvoice,
  completeBilling,
  getInvoiceHistory,
  getInvoiceDownloadUrl,
  getPractitionerLogs,
  getLogNotes,
  updateLogStatus,
  rejectLog,
  getVaultLogs,
  getBillingBatches,
  revertBillingBatch,
  markBatchPrinted,
  markBatchPaid,
  lockPractitioner,
  unlockPractitioner
} = require('../controllers/billingController');

// Covers Pending Bills + Completed Bills (and the read-only batches list, which
// Completed Bills also needs to know a batch's paid status before allowing revert).
const billingGuard = [protect, requireRole(['ceo', 'billing', 'account_specialist'])];

// Invoice Status tab's state-changing actions (mark printed / mark paid) are
// deliberately excluded from the plain "billing" role — Billing Specialists keep
// Pending Bills + Completed Bills, but not this tab.
const invoiceStatusWriteGuard = [protect, requireRole(['ceo', 'account_specialist'])];

router.get('/pending-logs',      ...billingGuard, getPendingLogs);
router.get('/practitioner-logs', ...billingGuard, getPractitionerLogs);
router.get('/log-notes',         ...billingGuard, getLogNotes);
router.patch('/log-status',      ...billingGuard, updateLogStatus);
router.post('/reject-log',       ...billingGuard, rejectLog);
router.post('/generate-njeis',   ...billingGuard, generateNJEISForms);
router.post('/generate-invoice', ...billingGuard, generateFinancialInvoice);
router.post('/complete-billing',  ...billingGuard, completeBilling);
router.get('/history',           ...billingGuard, getInvoiceHistory);
router.get('/download',          ...billingGuard, getInvoiceDownloadUrl);
router.get('/vault-logs',        ...billingGuard, getVaultLogs);
router.get('/batches',           ...billingGuard, getBillingBatches);
router.post('/revert-batch',     ...billingGuard, revertBillingBatch);
router.post('/practitioner/:id/lock',   ...billingGuard, lockPractitioner);
router.post('/practitioner/:id/unlock', ...billingGuard, unlockPractitioner);
router.patch('/batch/:id/printed', ...invoiceStatusWriteGuard, markBatchPrinted);
router.patch('/batch/:id/paid',    ...invoiceStatusWriteGuard, markBatchPaid);

module.exports = router;
