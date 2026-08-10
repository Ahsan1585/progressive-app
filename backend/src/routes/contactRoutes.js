const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { submitContactRequest } = require('../controllers/contactController');

// Public marketing-site form — throttled the same way forgot-password is,
// since it's an unauthenticated endpoint that sends an email on every hit.
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

router.post('/', contactLimiter, submitContactRequest);

module.exports = router;
