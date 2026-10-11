const express = require('express');
const router = express.Router();
const { protect, loadPermissions, requireRole } = require('../middleware/authMiddleware');
const { listNotifications, markNotificationRead } = require('../controllers/notificationController');

const independentGuard = [protect, loadPermissions, requireRole(['independent_practitioner'])];

router.get('/', ...independentGuard, listNotifications);
router.post('/:id/read', ...independentGuard, markNotificationRead);

module.exports = router;
