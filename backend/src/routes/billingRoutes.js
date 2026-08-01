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
  getMyInvoices,
  getMyInvoiceDownloadUrl,
  getPractitionerLogs,
  getLogNotes,
  getComplianceAnalysis,
  updateLogStatus,
  rejectLog,
  reconcileLog,
  addLogComment,
  getVaultLogs,
  getBillingBatches,
  revertBillingBatch,
  markBatchPrinted,
  markBatchPaid,
  lockPractitioner,
  unlockPractitioner,
  approveMissingInEims
} = require('../controllers/billingController');
const {
  allowComplianceField,
  listLearnedMatches,
  deleteLearnedMatch,
  updateComplianceStrictness,
} = require('../controllers/complianceLearningController');

// Covers Pending Bills + Completed Bills (and the read-only batches list, which
// Completed Bills also needs to know a batch's paid status before allowing revert).
const billingGuard = [protect, requireRole(['ceo', 'billing', 'account_specialist'])];

// Invoice Status tab's state-changing actions (mark printed / mark paid) are
// deliberately excluded from the plain "billing" role — Billing Specialists keep
// Pending Bills + Completed Bills, but not this tab.
const invoiceStatusWriteGuard = [protect, requireRole(['ceo', 'account_specialist'])];

// Self-service — any authenticated practitioner viewing their own invoices,
// not gated by the admin/billing-only billingGuard above.
router.get('/my-invoices',              protect, getMyInvoices);
router.get('/my-invoices/:id/download', protect, getMyInvoiceDownloadUrl);

router.get('/pending-logs',      ...billingGuard, getPendingLogs);
router.get('/practitioner-logs', ...billingGuard, getPractitionerLogs);
router.get('/log-notes',         ...billingGuard, getLogNotes);
router.get('/compliance-analysis', ...billingGuard, getComplianceAnalysis);
router.post('/compliance-analysis/allow-field', ...billingGuard, allowComplianceField);
router.get('/compliance-learned-matches',       ...billingGuard, listLearnedMatches);
router.delete('/compliance-learned-matches/:id', ...billingGuard, deleteLearnedMatch);
// Strictness itself (unlike viewing it or allowing/learning matches) is a
// ceo-only policy lever — mirrors every other Company Information write.
router.put('/compliance-strictness', protect, requireRole(['ceo']), updateComplianceStrictness);
// Missing-in-EIMS sign-off is a distinct admin gate from allow-field —
// ceo-only, mirrors the strictness lever above.
router.post('/compliance-analysis/approve-missing', protect, requireRole(['ceo']), approveMissingInEims);
router.patch('/log-status',      ...billingGuard, updateLogStatus);
router.post('/reject-log',       ...billingGuard, rejectLog);
router.post('/reconcile-log',    ...billingGuard, reconcileLog);
router.post('/log-comment',      ...billingGuard, addLogComment);
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
