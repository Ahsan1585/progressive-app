// CORS policy for the API: whitelisted frontend origins, plus the API's own
// origin. The server-rendered public pages (secure records gateway, parent
// consent page) submit plain HTML forms to this API, and browsers attach an
// Origin header (the API's own address) to form POSTs, so without the
// same-origin allowance every button on those pages fails.
//
// Used as a per-request options delegate because "same origin" depends on the
// request's own scheme and host (trust proxy = 1 makes req.protocol reflect
// the load balancer's X-Forwarded-Proto). CORS is not an authentication
// mechanism here: it only decides which browser origins may read responses.
function buildCorsOptions(allowedOrigins) {
  return (req, callback) => {
    const origin = req.headers?.origin;
    // No Origin header: same-origin GET or a non-browser client.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, { origin: true });
    const host = typeof req.get === 'function' ? req.get('host') : req.headers?.host;
    if (host && origin === `${req.protocol}://${host}`) return callback(null, { origin: true });
    return callback(new Error('Not allowed by CORS'));
  };
}

module.exports = { buildCorsOptions };
