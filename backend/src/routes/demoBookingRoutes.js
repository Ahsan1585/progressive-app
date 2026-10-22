const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { getSlots, createBooking, cancelBooking } = require('../controllers/demoBookingController');

// Public marketing-site endpoints (izayaedge.com/eis/book), unauthenticated.
// Booking sends two emails per hit, so it is throttled like the contact form;
// reading open times is cheap and gets a looser limit.
const limiter = (max) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

router.get('/slots', limiter(60), getSlots);
router.post('/bookings', limiter(5), createBooking);
router.post('/bookings/cancel', limiter(10), cancelBooking);

module.exports = router;
