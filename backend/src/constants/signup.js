// Slug validation shared by every path that can create a new tenant —
// the customer self-signup flow (signupController.js) and the
// platform-admin-triggered creation flow (platformProvisioningController.js).
// Kept in one place so the two never drift (e.g. a reserved word added to
// one and forgotten in the other).
const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

// Must not collide with an existing app route or a future subdomain.
const RESERVED_SLUGS = new Set([
  'api', 'www', 'admin', 'platform', 'signup', 'activate', 'login',
  'logout', 'app', 'assets', 'static', 'mail', 'support', 'help', 'eis',
]);

const TRIAL_DAYS = 15;

// Izaya One (independent-practitioner) signups get a longer free trial than
// a tenant-company signup — see independentSignupController.js, the only
// reader of this constant. signupController.js/platformProvisioningController.js
// both still read the shorter TRIAL_DAYS above.
const INDEPENDENT_TRIAL_DAYS = 30;

module.exports = { SLUG_REGEX, RESERVED_SLUGS, TRIAL_DAYS, INDEPENDENT_TRIAL_DAYS };
