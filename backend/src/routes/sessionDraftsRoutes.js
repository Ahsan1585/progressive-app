const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { saveDraft, listDrafts, getDraft, deleteDraft } = require('../controllers/sessionDraftsController');

router.post('/', protect, saveDraft);
router.get('/', protect, listDrafts);
router.get('/:patientId', protect, getDraft);
router.delete('/:patientId', protect, deleteDraft);

module.exports = router;
