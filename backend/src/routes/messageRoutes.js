const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requireOfficeStaff } = require('../middleware/authMiddleware');
const { getThreads, getThread, postMessage, getUnreadCount } = require('../controllers/messageController');

const officeGuard = [protect, loadPermissions, requireOfficeStaff];

router.get('/threads', ...officeGuard, getThreads);
router.get('/unread-count', protect, getUnreadCount);
router.get('/:practitionerId', protect, getThread);
router.post('/:practitionerId', protect, postMessage);

module.exports = router;
