const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { saveDraft, listDrafts, listDraftsForPatient, getDraft, deleteDraft } = require('../controllers/sessionDraftsController');

router.post('/', protect, saveDraft);
router.get('/', protect, listDrafts);
// Must come before /:draftId — a literal 'patient' segment never collides
// with a single dynamic segment, but keeping the specific route first
// documents the precedence explicitly.
router.get('/patient/:patientId', protect, listDraftsForPatient);
router.get('/:draftId', protect, getDraft);
router.delete('/:draftId', protect, deleteDraft);

module.exports = router;
