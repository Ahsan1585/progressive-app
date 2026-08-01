// backend/src/routes/roleRoutes.js
const express = require('express');
const { protect, loadPermissions, requirePermission, requireOfficeStaff } = require('../middleware/authMiddleware');
const { listRoles, createRole, updateRole, deleteRole } = require('../controllers/roleController');

const router = express.Router();
router.use(protect, loadPermissions);

// Any office staff member can read the role list (needed to populate the
// "assign role" dropdown even for someone who can't manage roles themselves).
router.get('/', requireOfficeStaff, listRoles);

router.post('/', requirePermission('staff_directory_edit_role'), createRole);
router.patch('/:id', requirePermission('staff_directory_edit_role'), updateRole);
router.delete('/:id', requirePermission('staff_directory_edit_role'), deleteRole);

module.exports = router;
