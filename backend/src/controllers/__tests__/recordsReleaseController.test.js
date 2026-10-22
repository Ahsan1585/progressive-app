// In-app "Send records" (staff create/list/revoke) and the recipient's public
// gateway (landing, emailed one-time code, download).
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({
  ...jest.requireActual('../../utils/emailClient'),
  sendRecordsReleaseEmail: jest.fn(),
  sendRecordsReleaseCodeEmail: jest.fn(),
}));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn().mockResolvedValue('Acme EI') }));
jest.mock('../consentReportController', () => ({
  buildConsentPacketPdf: jest.fn(),
  loadStaffNames: jest.fn(),
  recipientSlug: (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
}));

const crypto = require('crypto');
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { sendRecordsReleaseEmail, sendRecordsReleaseCodeEmail } = require('../../utils/emailClient');
const { buildConsentPacketPdf, loadStaffNames } = require('../consentReportController');
const ctrl = require('../recordsReleaseController');

afterEach(() => jest.resetAllMocks());

const future = (ms = 1e10) => new Date(Date.now() + ms).toISOString();
const past = () => new Date(Date.now() - 1e6).toISOString();
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const RAW = 'b'.repeat(64);
const codeHash = (id, code) => sha(`${id}:${code}`);

const consentRow = (o = {}) => ({
  id: 55, patient_id: 10, recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org', purpose: 'Billing',
  record_types: ['sevf_forms', 'invoices'], expires_at: future(), revoked_at: null, granted_by: 7, ...o,
});
const releaseRow = (o = {}) => ({
  id: 3, consent_id: 55, patient_id: 10, recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org',
  record_types: ['sevf_forms'], expires_at: future(), revoked_at: null, code_hash: null, code_expires_at: null,
  code_sent_at: null, code_attempts: 0, code_sends: 0, download_count: 0, ...o,
});

const mockRes = () => {
  const res = { headers: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn((k, v) => { if (typeof k === 'object') Object.assign(res.headers, k); else res.headers[k] = v; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  return res;
};
const staffReq = (o = {}) => ({
  params: { id: '10', consentId: '55' }, body: {}, headers: {}, protocol: 'https', get: () => 'api.example.com',
  practitioner: { practitionerId: 3, email: 'office@x.com', role: 'ceo', slug: 'acme' },
  ...o,
});
const pubReq = (o = {}) => ({
  params: { companySlug: 'acme', token: RAW }, body: {}, headers: {}, ip: '9.9.9.9',
  ...o,
});

// Routes pool.query by SQL text so tests don't depend on call order.
function primeDb(handlers) {
  pool.query.mockImplementation(async (sql, params) => {
    for (const [re, fn] of handlers) if (re.test(sql)) return typeof fn === 'function' ? fn(sql, params) : fn;
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('createRelease (staff)', () => {
  const baseHandlers = (consent = consentRow()) => [
    [/FROM records_consents/, { rows: consent ? [consent] : [] }],
    [/INSERT INTO records_releases/, (sql, params) => ({ rows: [{ id: 3, expires_at: params[6] }] })],
    [/UPDATE records_releases SET email_status/, { rows: [] }],
  ];

  test('rejects independent practitioners (agency only)', async () => {
    const res = mockRes();
    await ctrl.createRelease(staffReq({ practitioner: { practitionerId: 3, role: 'independent_practitioner' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('404 for a malformed id or a consent that is not this child\'s', async () => {
    const res = mockRes();
    await ctrl.createRelease(staffReq({ params: { id: 'x', consentId: '55' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);

    primeDb(baseHandlers(null));
    const res2 = mockRes();
    await ctrl.createRelease(staffReq(), res2);
    expect(res2.status).toHaveBeenCalledWith(404);
  });

  test.each([
    ['revoked', { revoked_at: past() }],
    ['expired', { expires_at: past() }],
  ])('409 when the consent is %s', async (_n, over) => {
    primeDb(baseHandlers(consentRow(over)));
    const res = mockRes();
    await ctrl.createRelease(staffReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(sendRecordsReleaseEmail).not.toHaveBeenCalled();
  });

  test('409 when the consent has no recipient email (recorded before it was required)', async () => {
    primeDb(baseHandlers(consentRow({ recipient_email: null })));
    const res = mockRes();
    await ctrl.createRelease(staffReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(sendRecordsReleaseEmail).not.toHaveBeenCalled();
  });

  test('400 when asked for a record type the consent does not approve', async () => {
    primeDb(baseHandlers());
    const res = mockRes();
    await ctrl.createRelease(staffReq({ body: { recordTypes: ['session_logs'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sendRecordsReleaseEmail).not.toHaveBeenCalled();
  });

  test('sends to the consent\'s email only, stores the token hash, audits without child names', async () => {
    primeDb(baseHandlers());
    sendRecordsReleaseEmail.mockResolvedValue();
    const res = mockRes();
    await ctrl.createRelease(staffReq({ body: { recordTypes: ['sevf_forms'], recipientEmail: 'evil@x.com' } }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    const insert = pool.query.mock.calls.find(([sql]) => /INSERT INTO records_releases/.test(sql));
    const params = insert[1];
    expect(params[2]).toMatch(/^[a-f0-9]{64}$/); // token hash, not raw
    expect(params[3]).toBe('ABC Billing');
    expect(params[4]).toBe('billing@abc.org');
    expect(params[5]).toEqual(['sevf_forms']);
    const [to, opts] = sendRecordsReleaseEmail.mock.calls[0];
    expect(to).toBe('billing@abc.org');
    expect(opts.releaseUrl).toMatch(/\/api\/released-records\/acme\/[a-f0-9]{64}$/);
    expect(sha(opts.releaseUrl.split('/').pop())).toBe(params[2]);
    const audit = logAudit.mock.calls[0][0];
    expect(audit.action).toBe('records_release_sent');
    expect(audit.resourceId).toBe('10');
    expect(JSON.stringify(audit.details)).not.toMatch(/Timmy/);
  });

  test('defaults to every record type the consent approves (full export expands to three)', async () => {
    primeDb(baseHandlers(consentRow({ record_types: ['full_record_export'] })));
    sendRecordsReleaseEmail.mockResolvedValue();
    await ctrl.createRelease(staffReq(), mockRes());
    const insert = pool.query.mock.calls.find(([sql]) => /INSERT INTO records_releases/.test(sql));
    expect(insert[1][5]).toEqual(['session_logs', 'sevf_forms', 'invoices']);
  });

  test('link never outlives the consent', async () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    primeDb(baseHandlers(consentRow({ expires_at: soon })));
    sendRecordsReleaseEmail.mockResolvedValue();
    await ctrl.createRelease(staffReq(), mockRes());
    const insert = pool.query.mock.calls.find(([sql]) => /INSERT INTO records_releases/.test(sql));
    expect(new Date(insert[1][6]).getTime()).toBeLessThanOrEqual(new Date(soon).getTime());
  });

  test('email failure: 502, release marked failed, no sent audit', async () => {
    primeDb(baseHandlers());
    sendRecordsReleaseEmail.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await ctrl.createRelease(staffReq(), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE records_releases SET email_status = 'failed'/.test(sql))).toBe(true);
    expect(logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'records_release_sent' }));
  });
});

describe('revokeRelease (staff)', () => {
  test('revokes and audits; 404 when nothing matches', async () => {
    primeDb([[/UPDATE records_releases/, { rows: [{ id: 3, consent_id: 55 }] }]]);
    const res = mockRes();
    await ctrl.revokeRelease(staffReq({ params: { id: '10', releaseId: '3' } }), res);
    expect(res.json).toHaveBeenCalled();
    expect(logAudit.mock.calls[0][0].action).toBe('records_release_revoked');

    primeDb([[/UPDATE records_releases/, { rows: [] }]]);
    const res2 = mockRes();
    await ctrl.revokeRelease(staffReq({ params: { id: '10', releaseId: '3' } }), res2);
    expect(res2.status).toHaveBeenCalledWith(404);
  });
});

describe('public gateway', () => {
  const lookup = (rel, consent = consentRow()) => [
    [/FROM records_releases/, { rows: rel ? [rel] : [] }],
    [/FROM records_consents/, { rows: consent ? [consent] : [] }],
  ];

  test('landing shows the notice and a code button, never the records, and does not count as an open', async () => {
    primeDb(lookup(releaseRow()));
    const res = mockRes();
    await ctrl.getReleaseLanding(pubReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const html = res.send.mock.calls[0][0];
    expect(html).toMatch(/FERPA/);
    expect(html).toMatch(/b\*\*\*@abc\.org/);
    expect(html).not.toContain('billing@abc.org');
    expect(pool.query.mock.calls.every(([sql]) => !/^\s*UPDATE/.test(sql))).toBe(true);
  });

  test.each([
    ['unknown link', null, 404],
    ['revoked link', releaseRow({ revoked_at: past() }), 410],
    ['expired link', releaseRow({ expires_at: past() }), 410],
  ])('%s is rejected', async (_n, rel, status) => {
    primeDb(lookup(rel));
    const res = mockRes();
    await ctrl.getReleaseLanding(pubReq(), res);
    expect(res.status).toHaveBeenCalledWith(status);
  });

  test('a malformed token is a 404 before any query', async () => {
    const res = mockRes();
    await ctrl.getReleaseLanding(pubReq({ params: { companySlug: 'acme', token: 'nope' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(pool.query).not.toHaveBeenCalled();
  });

  describe('requestCode', () => {
    test('emails a 6-digit code to the stored address only and stores only its hash', async () => {
      primeDb([
        ...lookup(releaseRow()),
        [/SET code_hash/, { rows: [{ id: 3 }] }],
      ]);
      sendRecordsReleaseCodeEmail.mockResolvedValue();
      const res = mockRes();
      await ctrl.requestCode(pubReq({ body: { email: 'attacker@x.com' } }), res);
      const [to, { code }] = sendRecordsReleaseCodeEmail.mock.calls[0];
      expect(to).toBe('billing@abc.org');
      expect(code).toMatch(/^\d{6}$/);
      const upd = pool.query.mock.calls.find(([sql]) => /SET code_hash/.test(sql));
      expect(upd[1]).toContain(codeHash(3, code));
      expect(upd[1]).not.toContain(code);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('cooldown: a second request within a minute sends nothing', async () => {
      primeDb(lookup(releaseRow({ code_sent_at: new Date().toISOString() })));
      const res = mockRes();
      await ctrl.requestCode(pubReq(), res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(sendRecordsReleaseCodeEmail).not.toHaveBeenCalled();
    });

    test('lifetime cap on codes per release', async () => {
      primeDb(lookup(releaseRow({ code_sends: 10 })));
      const res = mockRes();
      await ctrl.requestCode(pubReq(), res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(sendRecordsReleaseCodeEmail).not.toHaveBeenCalled();
    });

    test('email failure shows an error page, not a false "sent"', async () => {
      primeDb([...lookup(releaseRow()), [/SET code_hash/, { rows: [{ id: 3 }] }]]);
      sendRecordsReleaseCodeEmail.mockRejectedValue(new Error('down'));
      const res = mockRes();
      await ctrl.requestCode(pubReq(), res);
      expect(res.status).toHaveBeenCalledWith(502);
    });
  });

  describe('download', () => {
    const dlHandlers = (over = {}) => [
      ...lookup(releaseRow(over.release), over.consent),
      [/SET code_attempts = code_attempts \+ 1/, over.attempt ?? { rows: [{ id: 3, code_hash: codeHash(3, '123456'), code_attempts: 1 }] }],
      [/SET code_attempts = GREATEST/, { rows: [] }],
      [/SET download_count/, { rows: [] }],
      [/FROM patients/, { rows: [{ id: 10, first_name: 'Timmy', last_name: "O'Brien" }] }],
    ];

    test('correct code streams a fresh packet limited to the release record types, logs, no-store', async () => {
      primeDb(dlHandlers());
      loadStaffNames.mockResolvedValue(() => 'Sam Staff');
      buildConsentPacketPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
      const res = mockRes();
      await ctrl.downloadRelease(pubReq({ body: { code: '123456' } }), res);

      expect(buildConsentPacketPdf).toHaveBeenCalledWith(expect.objectContaining({
        recordTypes: ['sevf_forms'], generatedBy: expect.stringContaining('ABC Billing'),
      }));
      expect(res.headers['Content-Type']).toBe('application/pdf');
      expect(res.headers['Cache-Control']).toBe('no-store');
      expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
      const audit = logAudit.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'records_release_downloaded', actorRole: 'external_recipient', actorEmail: 'billing@abc.org', resourceType: 'patient', resourceId: 10 });
      expect(JSON.stringify(audit.details)).not.toMatch(/Timmy/);
    });

    test('wrong code: 403, counts the attempt, serves nothing', async () => {
      primeDb(dlHandlers());
      const res = mockRes();
      await ctrl.downloadRelease(pubReq({ body: { code: '000000' } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(buildConsentPacketPdf).not.toHaveBeenCalled();
    });

    test('no usable code (locked out / expired / never requested): 429 and nothing served', async () => {
      primeDb(dlHandlers({ attempt: { rows: [] } }));
      const res = mockRes();
      await ctrl.downloadRelease(pubReq({ body: { code: '123456' } }), res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(buildConsentPacketPdf).not.toHaveBeenCalled();
    });

    test.each([
      ['missing', undefined],
      ['not six digits', '12ab'],
      ['an object', { $ne: '' }],
    ])('code %s is rejected without touching attempts', async (_n, code) => {
      primeDb(dlHandlers());
      const res = mockRes();
      await ctrl.downloadRelease(pubReq({ body: { code } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(pool.query.mock.calls.every(([sql]) => !/code_attempts \+ 1/.test(sql))).toBe(true);
    });

    test.each([
      ['revoked', { consent: consentRow({ revoked_at: past() }) }],
      ['expired', { consent: consentRow({ expires_at: past() }) }],
    ])('a %s consent ends access even with a valid code and link', async (_n, over) => {
      primeDb(dlHandlers(over));
      const res = mockRes();
      await ctrl.downloadRelease(pubReq({ body: { code: '123456' } }), res);
      expect(res.status).toHaveBeenCalledWith(410);
      expect(buildConsentPacketPdf).not.toHaveBeenCalled();
    });
  });
});
