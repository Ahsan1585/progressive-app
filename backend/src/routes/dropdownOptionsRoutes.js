const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
const {
  getDropdownOptions,
  createDropdownOption,
  updateDropdownOption,
  deactivateDropdownOption,
  reactivateDropdownOption,
} = require('../controllers/dropdownOptionsController');

// Any authenticated role — the log-session form (practitioners included)
// needs these to render its Service Type/Status/Location/Group Size dropdowns.
router.get('/', protect, getDropdownOptions);

// Write: 'ceo' only, mirrors the Company Information tab itself being ceo-only.
const writeGuard = [protect, loadPermissions, requirePermission('company_info_dropdown_options')];
router.post('/', ...writeGuard, createDropdownOption);
router.put('/:id', ...writeGuard, updateDropdownOption);
router.delete('/:id', ...writeGuard, deactivateDropdownOption);
router.put('/:id/reactivate', ...writeGuard, reactivateDropdownOption);

module.exports = router;
