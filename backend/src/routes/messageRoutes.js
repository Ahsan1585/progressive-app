const express = require('express');
const router = express.Router();

const { protect, loadPermissions, requireOfficeStaff } = require('../middleware/authMiddleware');
const { getThreads, getThread, postMessage, getUnreadCount } = require('../controllers/messageController');
const { getDock, putDock } = require('../controllers/dockController');

const officeGuard = [protect, loadPermissions, requireOfficeStaff];

router.get('/threads', ...officeGuard, getThreads);
router.get('/unread-count', protect, getUnreadCount);
// Chat-dock state — MUST be registered before the /:practitionerId param
// route below, or Express matches "dock" as a practitioner id.
router.get('/dock', ...officeGuard, getDock);
router.put('/dock', ...officeGuard, putDock);
router.get('/:practitionerId', protect, getThread);
router.post('/:practitionerId', protect, postMessage);

module.exports = router;
