const express = require('express');
const router = express.Router();

const { protect, requireRole, loadPermissions, requirePermission } = require('../middleware/authMiddleware');

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
  getSessionComplianceStatus,
  sendMissingToAdmin,
  getActionRequiredLogs,
  decideMissingInEims
} = require('../controllers/billingController');
const {
  allowComplianceField,
  listLearnedMatches,
  deleteLearnedMatch,
  updateComplianceStrictness,
} = require('../controllers/complianceLearningController');

// Pending Bills tab.
const pendingGuard = [protect, loadPermissions, requirePermission('billing_pending')];

// Completed Bills tab (and the read-only batches list, which Completed Bills
// also needs to know a batch's paid status before allowing revert).
const completedGuard = [protect, loadPermissions, requirePermission('billing_completed')];

// Invoice Status tab's state-changing actions (mark printed / mark paid) are
// deliberately excluded from the plain "billing" role — Billing Specialists keep
// Pending Bills + Completed Bills, but not this tab.
const invoiceStatusWriteGuard = [protect, loadPermissions, requirePermission('billing_invoice_status')];

// Self-service — any authenticated practitioner viewing their own invoices,
// not gated by the admin/billing-only guards above.
router.get('/my-invoices',              protect, getMyInvoices);
router.get('/my-invoices/:id/download', protect, getMyInvoiceDownloadUrl);

router.get('/pending-logs',      ...pendingGuard, getPendingLogs);
router.get('/practitioner-logs', ...pendingGuard, getPractitionerLogs);
router.get('/log-notes',         ...pendingGuard, getLogNotes);
router.get('/compliance-analysis', ...pendingGuard, getComplianceAnalysis);
router.post('/compliance-analysis/allow-field', ...pendingGuard, allowComplianceField);
router.get('/compliance-learned-matches',       ...pendingGuard, listLearnedMatches);
router.delete('/compliance-learned-matches/:id', ...pendingGuard, deleteLearnedMatch);
// Strictness itself (unlike viewing it or allowing/learning matches) is a
// ceo-only policy lever — mirrors every other Company Information write.
router.put('/compliance-strictness', protect, requireRole(['ceo']), updateComplianceStrictness);
router.get('/compliance-analysis/session-status', ...pendingGuard, getSessionComplianceStatus);
// Missing-in-EIMS send-to-admin workflow: billing/ceo can send it (step 1),
// but only ceo sees the queue and can decide it (step 2) — mirrors the
// strictness lever above.
router.post('/compliance-analysis/send-missing-to-admin', ...pendingGuard, sendMissingToAdmin);
router.get('/action-required', protect, loadPermissions, requirePermission('action_required_approve'), getActionRequiredLogs);
router.post('/action-required/decide', protect, loadPermissions, requirePermission('action_required_approve'), decideMissingInEims);
router.patch('/log-status',      ...pendingGuard, updateLogStatus);
router.post('/reject-log',       ...pendingGuard, rejectLog);
router.post('/reconcile-log',    ...pendingGuard, reconcileLog);
router.post('/log-comment',      ...pendingGuard, addLogComment);
router.post('/generate-njeis',   ...pendingGuard, generateNJEISForms);
router.post('/generate-invoice', ...pendingGuard, generateFinancialInvoice);
router.post('/complete-billing',  ...pendingGuard, completeBilling);
router.get('/history',           ...completedGuard, getInvoiceHistory);
router.get('/download',          ...completedGuard, getInvoiceDownloadUrl);
router.get('/vault-logs',        ...completedGuard, getVaultLogs);
router.get('/batches',           ...completedGuard, getBillingBatches);
router.post('/revert-batch',     ...completedGuard, revertBillingBatch);
router.post('/practitioner/:id/lock',   ...pendingGuard, lockPractitioner);
router.post('/practitioner/:id/unlock', ...pendingGuard, unlockPractitioner);
router.patch('/batch/:id/printed', ...invoiceStatusWriteGuard, markBatchPrinted);
router.patch('/batch/:id/paid',    ...invoiceStatusWriteGuard, markBatchPaid);

module.exports = router;
