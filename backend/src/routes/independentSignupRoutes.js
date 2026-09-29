const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { requestIndependentSignup, confirmIndependentSignup } = require('../controllers/independentSignupController');

// Same rate-limiting posture as signupRoutes.js — this also triggers real
// infrastructure provisioning (CREATE DATABASE) once confirmed.
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

router.post('/', signupLimiter, requestIndependentSignup);
router.post('/confirm/:token', confirmLimiter, confirmIndependentSignup);

module.exports = router;
