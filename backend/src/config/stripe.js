// Lazy Stripe client — this app runs fine with no Stripe keys configured at
// all (subscription billing computes/records charges, it just can't collect
// payment yet). `getStripeClient()` returns null until STRIPE_SECRET_KEY is
// set, so every call site checks isStripeConfigured() first instead of
// crashing on a missing key. Once the key is added to the environment and
// the process restarts, every endpoint that gates on isStripeConfigured()
// starts working with no code change.
let stripeClient = null;
let attemptedInit = false;

function getStripeClient() {
  if (!attemptedInit) {
    attemptedInit = true;
    if (process.env.STRIPE_SECRET_KEY) {
      const Stripe = require('stripe');
      stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-08-27.basil' });
    }
  }
  return stripeClient;
}

function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// Google Pay rides on top of Stripe's Payment Request Button — it needs a
// verified merchant domain (registered via the Stripe Dashboard, tied to
// STRIPE_PUBLISHABLE_KEY) rather than a separate secret key. Surfaced to the
// frontend as its own readiness flag so the UI can show "Google Pay" as
// unavailable independently of plain-card readiness if it isn't set up yet.
function isGooglePayConfigured() {
  return isStripeConfigured() && Boolean(process.env.STRIPE_PUBLISHABLE_KEY);
}

module.exports = { getStripeClient, isStripeConfigured, isGooglePayConfigured };
