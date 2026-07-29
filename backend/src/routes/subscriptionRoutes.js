const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');
const {
  getConfig,
  getSummary,
  getInvoices,
  getInvoicePdf,
  getPaymentMethod,
  createSetupIntent,
  confirmPaymentMethod,
  generateInvoice,
  runScheduledBilling,
} = require('../controllers/subscriptionController');

// Admin-only, same as Company Information — this is what the agency owes
// Izaya, not a practitioner-facing concern.
const ceoOnly = [protect, requireRole(['ceo'])];

router.get('/config', ...ceoOnly, getConfig);
router.get('/summary', ...ceoOnly, getSummary);
router.get('/invoices', ...ceoOnly, getInvoices);
router.get('/invoices/:id/pdf', ...ceoOnly, getInvoicePdf);
router.get('/payment-method', ...ceoOnly, getPaymentMethod);
router.post('/payment-method/setup-intent', ...ceoOnly, createSetupIntent);
router.post('/payment-method/confirm', ...ceoOnly, confirmPaymentMethod);
router.post('/invoices/generate', ...ceoOnly, generateInvoice);

// Cloud Scheduler target (automatic monthly billing run, see index.js and
// subscriptionController.runScheduledBilling) — deliberately NOT behind
// protect/requireRole. Cloud Scheduler has no user session to send; it
// authenticates instead via the X-Cron-Secret header checked inside the
// handler, matched against CRON_SECRET.
router.post('/invoices/run-scheduled', runScheduledBilling);

// NOTE: the Stripe webhook is intentionally NOT mounted here — it must sit
// before the app-wide express.json() parser (raw body needed for signature
// verification). See index.js.

module.exports = router;
