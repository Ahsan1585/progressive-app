const express = require('express');
const router = express.Router();
const { protect, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
const { createInspectionRequest, listInspectionRequests, listForPatient, fulfillInspectionRequest } = require('../controllers/inspectionRequestController');

// Mounted at /api/inspection-requests. IDEA Part C 34 CFR 303.405.
const gate = [protect, loadPermissions, requirePermission('patient_record_rights')];
router.post('/', ...gate, createInspectionRequest);
router.get('/', ...gate, listInspectionRequests);
router.get('/patient/:patientId', ...gate, listForPatient);
router.patch('/:id/fulfill', ...gate, fulfillInspectionRequest);

module.exports = router;
