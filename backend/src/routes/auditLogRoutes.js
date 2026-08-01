const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
const { getAuditLogs } = require('../controllers/auditLogController');

// ceo ("Admin") only — this is the PHI access trail itself, so it's
// deliberately more locked down than Company Information's own read guard.
router.get('/', protect, loadPermissions, requirePermission('audit_logs'), getAuditLogs);

module.exports = router;
