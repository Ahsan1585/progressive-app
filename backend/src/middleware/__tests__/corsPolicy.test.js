// The API only answers whitelisted browser origins, but the server-rendered
// public pages (secure records gateway, parent consent page) post forms to the
// API from the API's OWN origin, and browsers send an Origin header on form
// POSTs. Those same-origin requests must be allowed or every button on those
// pages fails with a 500.
const { buildCorsOptions } = require('../corsPolicy');

const allowed = ['https://izayaedge.com', 'https://app.izayaedge.com'];
const decide = (headers, { protocol = 'https' } = {}) => {
  const req = { headers, protocol, get: (h) => headers[h.toLowerCase()] };
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
