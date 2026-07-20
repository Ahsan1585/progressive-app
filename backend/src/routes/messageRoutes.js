const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');
const { getThreads, getThread, postMessage, getUnreadCount } = require('../controllers/messageController');

const officeGuard = [protect, requireRole(['ceo', 'staff_director', 'billing', 'account_specialist'])];

router.get('/threads', ...officeGuard, getThreads);
router.get('/unread-count', protect, getUnreadCount);
router.get('/:practitionerId', protect, getThread);
router.post('/:practitionerId', protect, postMessage);

module.exports = router;
