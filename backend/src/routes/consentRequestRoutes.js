const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
const { listPendingConsentRequests } = require('../controllers/consentRequestController');

// Mounted at /api/consent-requests. Cross-child view of e-sign consent
// requests for the records-rights office (admin or patient_record_rights).
// The per-child endpoints live in patientRoutes.js under
// /api/patients/:id/consent-requests.
router.get('/pending', protect, loadPermissions, requirePermission('patient_record_rights'), listPendingConsentRequests);

module.exports = router;
