const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
const { listConsentRegister } = require('../controllers/consentRegisterController');

// Mounted at /api/consent-register. Agency-wide list of every consent for the
// records-rights office (admin or patient_record_rights).
router.get('/', protect, loadPermissions, requirePermission('patient_record_rights'), listConsentRegister);

module.exports = router;
