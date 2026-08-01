const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { requestSignup, confirmSignup } = require('../controllers/signupController');

// Signup triggers real infrastructure provisioning (CREATE DATABASE) once
// confirmed — tighter than the login limiter, since each bad request here
// is a resource-exhaustion vector, not just a credential-stuffing attempt.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again later.' },
});

const confirmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

router.post('/', signupLimiter, requestSignup);
router.post('/confirm/:token', confirmLimiter, confirmSignup);

module.exports = router;
