const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { submitUnsubscribe } = require('../controllers/marketingController');

// Public marketing-site link (the newsletter's unsubscribe footer) — same
// throttling convention as contactRoutes.js's demo-request form, since
// this is another unauthenticated endpoint that writes to the database on
// every hit.
const unsubscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

router.post('/unsubscribe', unsubscribeLimiter, submitUnsubscribe);

module.exports = router;
