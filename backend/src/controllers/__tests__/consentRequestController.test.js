jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({ sendConsentRequestEmail: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn() }));
const crypto = require('crypto');
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { sendConsentRequestEmail } = require('../../utils/emailClient');
const { getCompanyName } = require('../../utils/companyName');
const ctrl = require('../consentRequestController');

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const RID = '0b5e7d2a-4c1f-4a8e-9b3d-6f7a8c9d0e1f';
const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() });
const inAYear = () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
const body = (o = {}) => ({ recipientName: 'ABC Billing', recipientEmail: 'billing@abc.org', purpose: 'Billing', recordTypes: ['sevf_forms'], expiresAt: inAYear(), ...o });
const mkReq = (o = {}) => ({
  practitioner: { practitionerId: 7, slug: 'acme', role: 'practitioner' },
  params: { id: '42' },
  body: body(),
  headers: {},
  ...o,
});
const requestRow = (o = {}) => ({
  id: 'r1', patient_id: 42, recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org', purpose: 'Billing',
  record_types: ['sevf_forms'], consent_expires_at: inAYear(), requested_by: 7, parent_email: 'parent@x.com',
  request_expires_at: new Date(Date.now() + 1e8).toISOString(), status: 'pending', verify_failed_attempts: 0,
  verify_locked_at: null, signed_at: null, consent_id: null, created_at: new Date().toISOString(), ...o,
});

beforeEach(() => {
  process.env.FRONTEND_URL = 'https://app.example.com/eis';
  getCompanyName.mockResolvedValue('Acme Early Intervention');
});
afterEach(() => jest.resetAllMocks());

describe('createConsentRequest', () => {
  test("400 when the child has no parent email on file (and nothing is created or sent)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ parent_email: '  ' }] });
    const res = mkRes();
    await ctrl.createConsentRequest(mkReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toBe('This child has no parent email on file. Add one first.');
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(sendConsentRequestEmail).not.toHaveBeenCalled();
  });

  test('validates record types and future expiresAt before touching the DB', async () => {
    for (const b of [body({ recordTypes: ['bogus'] }), body({ recordTypes: [] }), body({ expiresAt: '2020-01-01' }), body({ expiresAt: 'nope' }), body({ recipientName: ' ' }), body({ purpose: '' })]) {
      const res = mkRes();
      await ctrl.createConsentRequest(mkReq({ body: b }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('stores only the sha256 of a 32-byte token, never returns the token or hash, and emails a link-only message', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] });
    const res = mkRes();
    await ctrl.createConsentRequest(mkReq(), res);

    const [insertSql, insertParams] = pool.query.mock.calls[1];
    expect(insertSql).toContain('INSERT INTO records_consent_requests');
    expect(insertSql).not.toMatch(/RETURNING \*/);

    // The email link carries the raw token; the DB only ever sees its hash.
    expect(sendConsentRequestEmail).toHaveBeenCalledTimes(1);
    const [to, emailArgs] = sendConsentRequestEmail.mock.calls[0];
    expect(to).toBe('parent@x.com');
    expect(Object.keys(emailArgs).sort()).toEqual(['organizationName', 'signUrl']);
    expect(emailArgs.organizationName).toBe('Acme Early Intervention');
    const m = /^https:\/\/app\.example\.com\/eis\/consent\/acme\/([0-9a-f]{64})$/.exec(emailArgs.signUrl);
    expect(m).not.toBeNull();
    const rawToken = m[1];
    expect(insertParams).toContain(sha256(rawToken));
    expect(insertParams).not.toContain(rawToken);

    // request_expires_at ~ now + 7 days
    const expiry = insertParams[9]; // request_expires_at (insertParams[5] is the consent's own expiry)
    expect(expiry).toBeInstanceOf(Date);
    expect(Math.abs(expiry.getTime() - (Date.now() + 7 * 24 * 60 * 60 * 1000))).toBeLessThan(60 * 1000);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    const json = JSON.stringify(payload);
    expect(json).not.toContain(rawToken);
    expect(json).not.toContain(sha256(rawToken));
    expect(payload.request).toMatchObject({ id: 'r1', patientId: 42, recipientName: 'ABC Billing', status: 'pending', recordTypes: ['sevf_forms'] });
    expect(payload.request.tokenHash).toBeUndefined();
  });

  test('the email carries no child data, recipient name or records detail', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] });
    await ctrl.createConsentRequest(mkReq(), mkRes());
    const emailJson = JSON.stringify(sendConsentRequestEmail.mock.calls[0]);
    expect(emailJson).not.toMatch(/ABC Billing|billing@abc\.org|sevf|Billing"/);
  });

  test('audits consent_request_created with ids and counts only', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] });
    await ctrl.createConsentRequest(mkReq(), mkRes());
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent_request_created', resourceType: 'patient', resourceId: '42',
      details: { requestId: 'r1', recordTypeCount: 1 },
    }));
  });

  test('if the email send throws, the request is cancelled and a clear 502 is returned', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] })
      .mockResolvedValueOnce({ rowCount: 1 });
    sendConsentRequestEmail.mockRejectedValueOnce(new Error('smtp down'));
    const res = mkRes();
    await ctrl.createConsentRequest(mkReq(), res);
    const [cancelSql, cancelParams] = pool.query.mock.calls[2];
    expect(cancelSql).toMatch(/SET status = 'cancelled'/);
    expect(cancelParams).toContain('r1');
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json.mock.calls[0][0].error).toMatch(/could not send/i);
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe('createConsentRequest when email is not configured / returns an error', () => {
  test.each([
    ['not configured', new Error('Email is not configured (RESEND_API_KEY not set); consent request email was not sent.')],
    ['Resend error result', new Error('Consent request email failed: Invalid `to` field')],
  ])('%s: cancels the request and returns 502, never 201', async (_l, err) => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] })
      .mockResolvedValueOnce({ rowCount: 1 });
    sendConsentRequestEmail.mockRejectedValueOnce(err);
    const res = mkRes();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await ctrl.createConsentRequest(mkReq(), res);
    errSpy.mockRestore();
    expect(pool.query.mock.calls[2][0]).toMatch(/SET status = 'cancelled'/);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.status).not.toHaveBeenCalledWith(201);
  });
});

describe('listConsentRequests', () => {
  test("returns the child's requests newest first, computing 'expired' for a lapsed pending link", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        requestRow({ id: 'a' }),
        requestRow({ id: 'b', request_expires_at: new Date(Date.now() - 1000).toISOString() }),
        requestRow({ id: 'c', status: 'signed', consent_id: 9 }),
      ],
    });
    const res = mkRes();
    await ctrl.listConsentRequests(mkReq(), res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE patient_id = \$1/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(sql).not.toMatch(/token_hash/);
    expect(params).toEqual(['42']);
    const { requests } = res.json.mock.calls[0][0];
    expect(requests.map((r) => r.status)).toEqual(['pending', 'expired', 'signed']);
    expect(requests[2].consentId).toBe(9);
  });
});

describe('resendConsentRequest', () => {
  const req = () => mkReq({ params: { id: '42', requestId: RID }, body: {} });

  test('404 when the request does not belong to this child', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = mkRes();
    await ctrl.resendConsentRequest(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('409 for a signed or cancelled request', async () => {
    for (const status of ['signed', 'cancelled']) {
      pool.query.mockResolvedValueOnce({ rows: [requestRow({ status })] });
      const res = mkRes();
      await ctrl.resendConsentRequest(req(), res);
      expect(res.status).toHaveBeenCalledWith(409);
    }
    expect(sendConsentRequestEmail).not.toHaveBeenCalled();
  });

  test('issues a new token, resets the attempt lock, opens a new 7-day window, and re-sends', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [requestRow({ verify_locked_at: new Date().toISOString(), request_expires_at: new Date(Date.now() - 1000).toISOString() })] })
      .mockResolvedValueOnce({ rows: [{ parent_email: 'new-parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow({ parent_email: 'new-parent@x.com' })] });
    const res = mkRes();
    await ctrl.resendConsentRequest(req(), res);

    const [updSql, updParams] = pool.query.mock.calls[2];
    expect(updSql).toMatch(/SET token_hash = \$1/);
    expect(updSql).toMatch(/verify_failed_attempts = 0/);
    expect(updSql).toMatch(/verify_locked_at = NULL/);
    expect(updSql).toMatch(/status = 'pending'/);
    expect(updSql).toMatch(/status IN \('pending', 'expired'\)/);
    const [to, { signUrl }] = sendConsentRequestEmail.mock.calls[0];
    expect(to).toBe('new-parent@x.com');
    const rawToken = signUrl.split('/').pop();
    expect(updParams[0]).toBe(sha256(rawToken));
    expect(updParams[1].getTime()).toBeGreaterThan(Date.now() + 6.9 * 24 * 60 * 60 * 1000);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'consent_request_resent', details: { requestId: RID } }));
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain(rawToken);
  });

  test('429 when it was sent less than 2 minutes ago, so staff cannot flood a parent inbox (nothing sent or changed)', async () => {
    const sentThirtySecondsAgo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 30 * 1000).toISOString();
    pool.query.mockResolvedValueOnce({ rows: [requestRow({ request_expires_at: sentThirtySecondsAgo })] });
    const res = mkRes();
    await ctrl.resendConsentRequest(req(), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].error).toMatch(/wait/i);
    expect(sendConsentRequestEmail).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('allows a resend once the 2 minute cooldown has passed', async () => {
    const sentFiveMinutesAgo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 5 * 60 * 1000).toISOString();
    pool.query
      .mockResolvedValueOnce({ rows: [requestRow({ request_expires_at: sentFiveMinutesAgo })] })
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] });
    const res = mkRes();
    await ctrl.resendConsentRequest(req(), res);
    expect(res.status).not.toHaveBeenCalledWith(429);
    expect(sendConsentRequestEmail).toHaveBeenCalledTimes(1);
  });

  test('400 when the child no longer has a parent email', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [requestRow()] })
      .mockResolvedValueOnce({ rows: [{ parent_email: null }] });
    const res = mkRes();
    await ctrl.resendConsentRequest(req(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sendConsentRequestEmail).not.toHaveBeenCalled();
  });

  test('502 when the email send throws', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [requestRow()] })
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] });
    sendConsentRequestEmail.mockRejectedValueOnce(new Error('down'));
    const res = mkRes();
    await ctrl.resendConsentRequest(req(), res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  test("a failed resend restores the previous token, window and status so the parent's old link still works", async () => {
    const oldExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const loaded = requestRow({ token_hash: 'OLD_HASH', request_expires_at: oldExpiry, status: 'pending' });
    pool.query
      .mockResolvedValueOnce({ rows: [loaded] })
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] }) // rotate
      .mockResolvedValueOnce({ rowCount: 1 }); // restore
    sendConsentRequestEmail.mockRejectedValueOnce(new Error('down'));
    const res = mkRes();
    await ctrl.resendConsentRequest(req(), res);

    // The load must read the old token_hash so it can be restored.
    expect(pool.query.mock.calls[0][0]).toMatch(/token_hash/);
    const newHash = pool.query.mock.calls[2][1][0];
    const [restoreSql, restoreParams] = pool.query.mock.calls[3];
    expect(restoreSql).toMatch(/UPDATE records_consent_requests/);
    expect(restoreSql).toMatch(/SET token_hash = \$1/);
    expect(restoreSql).toMatch(/request_expires_at = \$2/);
    expect(restoreSql).toMatch(/status = \$3/);
    // Only undo our own rotation: guarded by the new hash.
    expect(restoreSql).toMatch(/token_hash = \$\d+/);
    expect(restoreParams.slice(0, 3)).toEqual(['OLD_HASH', oldExpiry, 'pending']);
    expect(restoreParams).toContain(newHash);
    expect(restoreParams).toContain(RID);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(logAudit).not.toHaveBeenCalled();
    // The token hash never leaks to the client.
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('OLD_HASH');
  });

  test('a successful resend never returns token_hash to the client', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [requestRow({ token_hash: 'OLD_HASH', request_expires_at: new Date(Date.now() + 1e6).toISOString() })] })
      .mockResolvedValueOnce({ rows: [{ parent_email: 'parent@x.com' }] })
      .mockResolvedValueOnce({ rows: [requestRow()] });
    const res = mkRes();
    await ctrl.resendConsentRequest(req(), res);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/OLD_HASH|tokenHash|token_hash/);
  });
});

describe('length limits on the request path (shared validation)', () => {
  test.each([
    ['recipientName', { recipientName: 'x'.repeat(201) }, /200/],
    ['recipientEmail', { recipientEmail: `${'x'.repeat(200)}@a.org` }, /200/],
    ['purpose', { purpose: 'x'.repeat(501) }, /500/],
    ['expiry > 5 years', { expiresAt: new Date(Date.now() + 6 * 365 * 24 * 3600 * 1000).toISOString() }, /5 years/],
  ])('400 for %s, before touching the DB', async (_l, o, re) => {
    const res = mkRes();
    await ctrl.createConsentRequest(mkReq({ body: body(o) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(re);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('bad ids are 404, never 500, and never reach the DB', () => {
  const UUID = '3f2b8c1e-9d4a-4e7b-8a6c-1b2c3d4e5f60';
  test.each(['abc', '-1', '4.2', '99999999999'])('non-numeric patient id %p', async (id) => {
    for (const fn of ['createConsentRequest', 'listConsentRequests', 'resendConsentRequest', 'cancelConsentRequest']) {
      const res = mkRes();
      await ctrl[fn](mkReq({ params: { id, requestId: UUID } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(pool.query).not.toHaveBeenCalled();
    expect(sendConsentRequestEmail).not.toHaveBeenCalled();
  });

  test.each(['r1', 'not-a-uuid', `${UUID}x`, "' OR 1=1"])('non-UUID requestId %p', async (requestId) => {
    for (const fn of ['resendConsentRequest', 'cancelConsentRequest']) {
      const res = mkRes();
      await ctrl[fn](mkReq({ params: { id: '42', requestId } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('cancelConsentRequest', () => {
  const req = () => mkReq({ params: { id: '42', requestId: RID }, body: {} });

  test('cancels a pending request scoped to this child', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
    const res = mkRes();
    await ctrl.cancelConsentRequest(req(), res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/SET status = 'cancelled'/);
    expect(sql).toMatch(/patient_id = \$2/);
    expect(sql).toMatch(/status = 'pending'/);
    expect(params).toEqual([RID, '42']);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'consent_request_cancelled', details: { requestId: RID } }));
  });

  test('409 when the request exists but is no longer pending', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ status: 'signed' }] });
    const res = mkRes();
    await ctrl.cancelConsentRequest(req(), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('404 when the request is not this child’s', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = mkRes();
    await ctrl.cancelConsentRequest(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('listPendingConsentRequests (cross-child)', () => {
  test('returns every child’s requests, pending first, with the camelCase shape', async () => {
    const now = Date.now();
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 'a', patient_id: 1, first_name: 'Kid', last_name: 'One', recipient_name: 'ABC', status: 'pending', created_at: 't1', request_expires_at: new Date(now + 1e6).toISOString(), consent_expires_at: 'c1' },
        { id: 'b', patient_id: 2, first_name: 'Kid', last_name: 'Two', recipient_name: 'XYZ', status: 'signed', created_at: 't2', request_expires_at: new Date(now + 1e6).toISOString(), consent_expires_at: 'c2' },
      ],
    });
    const res = mkRes();
    await ctrl.listPendingConsentRequests(mkReq(), res);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/JOIN patients/);
    expect(sql).toMatch(/ORDER BY CASE WHEN r\.status = 'pending' AND r\.request_expires_at > now\(\) THEN 0 ELSE 1 END/);
    expect(sql).not.toMatch(/token_hash/);
    const { requests } = res.json.mock.calls[0][0];
    expect(requests[0]).toEqual({
      id: 'a', patientId: 1, patientName: 'Kid One', recipientName: 'ABC', status: 'pending',
      requestedAt: 't1', requestExpiresAt: expect.any(String), consentExpiresAt: 'c1',
    });
    expect(requests[1].status).toBe('signed');
  });

  // Review finding I5: patientName was built from the raw, undecrypted
  // first_name/last_name columns.
  test('decrypts first_name/last_name before building patientName', async () => {
    process.env.FIELD_ENCRYPTION_KEY = process.env.FIELD_ENCRYPTION_KEY || require('crypto').randomBytes(32).toString('base64');
    process.env.FIELD_INDEX_KEY = process.env.FIELD_INDEX_KEY || require('crypto').randomBytes(32).toString('base64');
    const { encryptField } = require('../../utils/fieldEncryption');
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 'a', patient_id: 1, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), recipient_name: 'ABC', status: 'pending', created_at: 't1', request_expires_at: new Date(Date.now() + 1e6).toISOString(), consent_expires_at: 'c1' },
      ],
    });
    const res = mkRes();
    await ctrl.listPendingConsentRequests(mkReq(), res);
    const { requests } = res.json.mock.calls[0][0];
    expect(requests[0].patientName).toBe('Luz Quintero');
  });
});
