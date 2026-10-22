// CORS policy for the API: only whitelisted frontend origins (plus the API's own
// origin) may make browser requests. Per-request delegate because "same origin"
// depends on the request's own scheme and host (trust proxy = 1 makes
// req.protocol reflect the load balancer's X-Forwarded-Proto). CORS is not an
// authentication mechanism here: it only decides which browser origins may read
// responses.
//
// Server-rendered public pages (plain HTML forms, secret-token gated, no cookies).
// Their form posts carry "Origin: null" (the API sends Referrer-Policy:
// no-referrer, and browsers then null the Origin), which no whitelist can match.
// They are never meant to be read by another site, so they skip CORS entirely:
// no error, and no CORS headers are granted to anyone.
const PUBLIC_PAGE_PREFIXES = ['/api/released-records/', '/api/consent-manage/'];

function buildCorsOptions(allowedOrigins) {
  return (req, callback) => {
    const url = req.originalUrl || req.url || '';
    if (PUBLIC_PAGE_PREFIXES.some((prefix) => url.startsWith(prefix))) return callback(null, { origin: false });
    const origin = req.headers?.origin;
    // No Origin header: same-origin GET or a non-browser client.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, { origin: true });
    const host = typeof req.get === 'function' ? req.get('host') : req.headers?.host;
    if (host && origin === `${req.protocol}://${host}`) return callback(null, { origin: true });
    return callback(new Error('Not allowed by CORS'));
  };
}

module.exports = { buildCorsOptions };
