// Every /api response can carry child records (names, DOBs, session notes) or
// a generated PDF. Telling browsers and proxies not to cache keeps that data
// from lingering in a shared or personal device's cache after logout, which
// is the practical control behind the "no PHI left on devices" policy.
module.exports = function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, private');
  next();
};
