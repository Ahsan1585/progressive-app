const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requireRole } = require('../middleware/authMiddleware');
const { listAgencies, createAgency, updateAgency, deleteAgency } = require('../controllers/agencyController');

// Independent-practitioner-only — mirrors billingRoutes.js's independentGuard
// exactly. No office/admin concept exists for this role, so every agency
// here is scoped purely by practitioner_id, no permission system involved.
const independentGuard = [protect, loadPermissions, requireRole(['independent_practitioner'])];

router.get('/', ...independentGuard, listAgencies);
router.post('/', ...independentGuard, createAgency);
router.put('/:id', ...independentGuard, updateAgency);
router.delete('/:id', ...independentGuard, deleteAgency);

module.exports = router;
