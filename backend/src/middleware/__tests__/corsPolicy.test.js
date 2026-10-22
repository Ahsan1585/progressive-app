// The API only answers whitelisted browser origins, but the server-rendered
// public pages (secure records gateway, parent consent page) post forms to the
// API from the API's OWN origin, and browsers send an Origin header on form
// POSTs. Those same-origin requests must be allowed or every button on those
// pages fails with a 500.
const { buildCorsOptions } = require('../corsPolicy');

const allowed = ['https://izayaedge.com', 'https://app.izayaedge.com'];
const decide = (headers, { protocol = 'https', url = '/api/patients' } = {}) => {
  const req = { headers, protocol, originalUrl: url, get: (h) => headers[h.toLowerCase()] };
  let result;
  buildCorsOptions(allowed)(req, (err, opts) => { result = { err, opts }; });
  return result;
};

test('no Origin header (non-browser / same-origin GET) is allowed', () => {
  expect(decide({ host: 'api.example.run.app' }).opts.origin).toBe(true);
});

test('a whitelisted frontend origin is allowed', () => {
  const r = decide({ origin: 'https://izayaedge.com', host: 'api.example.run.app' });
  expect(r.err).toBeNull();
  expect(r.opts.origin).toBe(true);
});

test("the API's own origin is allowed (form POSTs from its server-rendered pages)", () => {
  const r = decide({ origin: 'https://api.example.run.app', host: 'api.example.run.app' });
  expect(r.err).toBeNull();
  expect(r.opts.origin).toBe(true);
});

test('another site is still rejected', () => {
  const r = decide({ origin: 'https://evil.example', host: 'api.example.run.app' });
  expect(r.err).toBeInstanceOf(Error);
  expect(r.err.message).toBe('Not allowed by CORS');
});

test('same host but a different scheme is not same-origin', () => {
  const r = decide({ origin: 'http://api.example.run.app', host: 'api.example.run.app' }, { protocol: 'https' });
  expect(r.err).toBeInstanceOf(Error);
});

test('a lookalike host is not same-origin', () => {
  const r = decide({ origin: 'https://api.example.run.app.evil.example', host: 'api.example.run.app' });
  expect(r.err).toBeInstanceOf(Error);
});

// The server-rendered public pages send "Origin: null" on their form posts
// because the API's Referrer-Policy is no-referrer. Those pages are never meant
// to be read cross-origin and are gated by a secret token (no cookies), so they
// are exempt from CORS: no error, and no CORS headers granted to anyone.
describe.each([
  '/api/released-records/acme/' + 'a'.repeat(64) + '/code',
  '/api/released-records/acme/' + 'a'.repeat(64) + '/download',
  '/api/consent-manage/acme/' + 'a'.repeat(64) + '/withdraw',
])('public server-rendered page %s', (url) => {
  test('a form post with Origin: null is not rejected', () => {
    const r = decide({ origin: 'null', host: 'api.example.run.app' }, { url });
    expect(r.err).toBeNull();
  });

  test('and it is granted no CORS access for other sites', () => {
    const r = decide({ origin: 'https://evil.example', host: 'api.example.run.app' }, { url });
    expect(r.err).toBeNull();
    expect(r.opts.origin).toBe(false);
  });
});

test('Origin: null is still rejected everywhere else', () => {
  const r = decide({ origin: 'null', host: 'api.example.run.app' }, { url: '/api/patients' });
  expect(r.err).toBeInstanceOf(Error);
});

test('a look-alike path does not get the exemption', () => {
  const r = decide({ origin: 'null', host: 'api.example.run.app' }, { url: '/api/released-recordsX/a' });
  expect(r.err).toBeInstanceOf(Error);
});
