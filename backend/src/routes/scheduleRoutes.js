const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { createSession, updateSession, cancelSession, listSessions } = require('../controllers/scheduleController');

// No requireRole — any practitioner can schedule for their own patients, same
// access level as logging a session. Ownership is enforced in the controller.
router.get('/', protect, listSessions);
router.post('/', protect, createSession);
router.patch('/:id', protect, updateSession);
router.patch('/:id/cancel', protect, cancelSession);

module.exports = router;
