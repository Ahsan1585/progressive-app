const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const {
  startInstagramConnect,
  getInstagramStatus,
  disconnectInstagram,
} = require('../controllers/instagramController');

// All Instagram routes act on the logged-in user's company (tenant), so
// they require an authenticated session same as the rest of the app.
router.post('/connect', protect, startInstagramConnect);
router.get('/status', protect, getInstagramStatus);
router.delete('/connection/:id', protect, disconnectInstagram);

module.exports = router;
