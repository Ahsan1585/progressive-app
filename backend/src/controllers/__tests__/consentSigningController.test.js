jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({ sendConsentManageEmail: jest.fn() }));
jest.mock('../../utils/consentNotify', () => ({ notifyConsentStaff: jest.fn() }));
const crypto = require('crypto');
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { getCompanyName } = require('../../utils/companyName');
const { sendConsentManageEmail } = require('../../utils/emailClient');
const { notifyConsentStaff } = require('../../utils/consentNotify');
const { checkConsent } = require('../../utils/recordsConsent');
const ctrl = require('../consentSigningController');

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() });
const mkReq = (body = {}) => ({
  params: { token: 'tok', companySlug: 'acme' }, body,
  headers: { 'user-agent': 'UA/1.0', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, ip: '1.2.3.4',
});
const future = (ms = 1e8) => new Date(Date.now() + ms).toISOString();
const row = (o = {}) => ({
  id: 'req1', patient_id: 42, token_hash: sha256('tok'), status: 'pending', request_expires_at: future(),
  consent_expires_at: future(365 * 24 * 3600 * 1000), recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org',
  purpose: 'Billing', record_types: ['sevf_forms'], requested_by: 7, parent_email: 'p@x.com',
  patient_dob: '2024-03-05', patient_first_name: 'Timmy', patient_last_name: 'Tester',
  verify_failed_attempts: 0, verify_locked_at: null, ...o,
});
const CLAIM_SQL = /SET verify_failed_attempts = verify_failed_attempts \+ 1/;
const RESET_SQL = /SET verify_failed_attempts = 0/;
const callsMatching = (re) => pool.query.mock.calls.filter(([sql]) => re.test(sql));

let client;
beforeEach(() => {
  getCompanyName.mockResolvedValue('Acme EI');
  client = { query: jest.fn(), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
});
afterEach(() => jest.resetAllMocks());

describe('getConsentSigningState', () => {
  test('looks up by token hash and returns only requiresVerification', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row()] });
    const res = mkRes();
    await ctrl.getConsentSigningState(mkReq(), res);
    expect(pool.query.mock.calls[0][1]).toEqual([sha256('tok')]);
    expect(res.json.mock.calls[0][0]).toEqual({ success: true, requiresVerification: true });
  });

  test.each([
    ['unknown token (also: a token from another tenant, since the tenant comes from the slug)', null, 'invalid'],
    ['cancelled', row({ status: 'cancelled' }), 'no_longer_valid'],
    ['signed', row({ status: 'signed' }), 'no_longer_valid'],
    ['expired by status', row({ status: 'expired' }), 'no_longer_valid'],
    ['expired by time', row({ request_expires_at: new Date(Date.now() - 1000).toISOString() }), 'no_longer_valid'],
  ])('404 for %s, with no details', async (_label, r, code) => {
    pool.query.mockResolvedValueOnce({ rows: r ? [r] : [] });
    const res = mkRes();
    await ctrl.getConsentSigningState(mkReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error).toBe(code);
    expect(JSON.stringify(payload)).not.toMatch(/ABC|Billing|sevf|42|Timmy|Tester/);
  });

  test('423 when locked', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row({ verify_locked_at: new Date().toISOString() })] });
    const res = mkRes();
    await ctrl.getConsentSigningState(mkReq(), res);
    expect(res.status).toHaveBeenCalledWith(423);
  });
});

describe('the child is named only after the date of birth is verified', () => {
  test('a wrong DOB reveals no child name', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2020-01-01' }), res);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/Timmy|Tester/);
  });

  test('a name with only a first name is still shown cleanly', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row({ patient_last_name: null })] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2024-03-05' }), res);
    expect(res.json.mock.calls[0][0].childName).toBe('Timmy');
  });
});

describe('verifyConsentSigningIdentity', () => {
  test('correct DOB returns the request details and attestation text, resetting the counter', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2024-03-05' }), res);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toEqual({
      success: true,
      childName: 'Timmy Tester',
      recipientName: 'ABC Billing', purpose: 'Billing', recordTypes: ['sevf_forms'],
      consentExpiresAt: expect.any(String),
      organizationName: 'Acme EI',
      attestationText: ctrl.ATTESTATION_TEXT,
    });
    expect(ctrl.ATTESTATION_TEXT).toBe('I am the parent or legal guardian of this child. I authorize the disclosure described above. I understand I may revoke this consent at any time by contacting the agency, and that my electronic signature has the same legal effect as my handwritten signature.');
    expect(callsMatching(CLAIM_SQL)).toHaveLength(1);
    expect(callsMatching(RESET_SQL)).toHaveLength(1);
  });

  test('accepts a pg Date for the DOB', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row({ patient_dob: new Date(2024, 2, 5) })] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2024-03-05' }), res);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  test('the attempt is claimed by ONE conditional UPDATE before the DOB is compared', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2024-03-05' }), mkRes());
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE records_consent_requests/);
    expect(sql).toMatch(CLAIM_SQL);
    expect(sql).toMatch(/verify_locked_at IS NULL/);
    expect(sql).toMatch(/verify_failed_attempts < \$\d/);
    expect(sql).toMatch(/token_hash = \$\d/);
    expect(sql).toMatch(/verify_locked_at = CASE WHEN verify_failed_attempts \+ 1 >= \$\d THEN now\(\)/);
    expect(params).toEqual(expect.arrayContaining(['req1', 5]));
  });

  test('a lost claim (parallel request used the last attempt) is 423 even with the right DOB', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row({ verify_failed_attempts: 4 })] }).mockResolvedValueOnce({ rows: [] });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2024-03-05' }), res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json.mock.calls[0][0].recipientName).toBeUndefined();
    expect(callsMatching(RESET_SQL)).toHaveLength(0);
  });

  test('wrong DOB: generic 403 with no details', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2020-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error).toBe('verification_failed');
    expect(JSON.stringify(payload)).not.toMatch(/ABC|Billing|birth|2024/i);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('5th failure locks the link and audits consent_signing_locked (ids only, no actor)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row({ verify_failed_attempts: 4 })] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 5, verify_locked_at: new Date().toISOString() }] });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2020-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(423);
    const audit = logAudit.mock.calls[0][0];
    expect(audit).toMatchObject({ action: 'consent_signing_locked', resourceType: 'patient', resourceId: 42, actorId: null, details: { requestId: 'req1', failedAttempts: 5 } });
    expect(audit.actorEmail).toBeFalsy();
  });

  test('already-locked link rejects even a correct DOB without claiming an attempt', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row({ verify_locked_at: new Date().toISOString() })] });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2024-03-05' }), res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(callsMatching(CLAIM_SQL)).toHaveLength(0);
  });

  test('malformed DOB counts as a failed attempt', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '03/05/2024' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(callsMatching(CLAIM_SQL)).toHaveLength(1);
  });
});

describe('signConsent', () => {
  const goodBody = (o = {}) => ({ dob: '2024-03-05', typedName: '  Pat Parent ', attested: true, ...o });
  const primeVerified = (r = row()) => {
    pool.query.mockResolvedValueOnce({ rows: [r] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
  };

  test.each([
    ['missing typedName', { typedName: undefined }],
    ['one-character typedName', { typedName: ' P ' }],
    ['attested missing', { attested: undefined }],
    ['attested not exactly true', { attested: 'true' }],
  ])('400 for %s, before any lookup', async (_l, o) => {
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody(o)), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('in ONE transaction: claims the request, inserts the electronic consent, links consent_id', async () => {
    primeVerified();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'req1' }] }) // claim
      .mockResolvedValueOnce({ rows: [{ id: 77 }] }) // INSERT consent
      .mockResolvedValueOnce({ rowCount: 1 }) // link consent_id
      .mockResolvedValueOnce({}); // COMMIT
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody()), res);

    const sqls = client.query.mock.calls.map(([s]) => s);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toMatch(/UPDATE records_consent_requests[\s\S]*SET status = 'signed'[\s\S]*WHERE id = \$1 AND status = 'pending'/);
    expect(sqls[2]).toMatch(/INSERT INTO records_consents/);
    expect(sqls[2]).toMatch(/'electronic'/);
    expect(sqls[2]).toMatch(/'electronic_dob'/);
    expect(sqls[3]).toMatch(/SET consent_id = \$1/);
    expect(sqls[4]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();

    const claimParams = client.query.mock.calls[1][1];
    expect(claimParams).toEqual(expect.arrayContaining(['req1', '1.2.3.4', 'UA/1.0', 'Pat Parent']));
    const insertParams = client.query.mock.calls[2][1];
    // patient, recipient, email, purpose, types, granted_by = requested_by, expires_at, ip, ua, name, request_id
    expect(insertParams.slice(0, 6)).toEqual([42, 'ABC Billing', 'billing@abc.org', 'Billing', ['sevf_forms'], 7]);
    expect(new Date(insertParams[6]).getTime()).toBeGreaterThan(Date.now() + 300 * 24 * 3600 * 1000);
    expect(insertParams).toEqual(expect.arrayContaining(['1.2.3.4', 'UA/1.0', 'Pat Parent', 'req1']));
    expect(client.query.mock.calls[3][1]).toEqual([77, 'req1']);

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent_signed_electronically', resourceType: 'patient', resourceId: 42, actorId: null,
      details: { requestId: 'req1', consentId: 77, recordTypeCount: 1 },
    }));
  });

  test('stores the exact attestation wording shown to the parent in records_consents.attestation_text', async () => {
    primeVerified();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'req1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    await ctrl.signConsent(mkReq(goodBody()), mkRes());
    const [insertSql, insertParams] = client.query.mock.calls[2];
    expect(insertSql).toMatch(/attestation_text/);
    // The column list and the placeholder for attestation_text line up.
    const cols = /\(([^)]*)\)\s*VALUES/.exec(insertSql)[1].split(',').map((s) => s.trim());
    const vals = /VALUES\s*\(([\s\S]*)\)\s*RETURNING/.exec(insertSql)[1].split(/,(?=(?:[^']*'[^']*')*[^']*$)/).map((s) => s.trim());
    const placeholder = vals[cols.indexOf('attestation_text')];
    expect(placeholder).toMatch(/^\$\d+$/);
    expect(insertParams[Number(placeholder.slice(1)) - 1]).toBe(ctrl.ATTESTATION_TEXT);
  });

  test('records req.ip (resolved by trust proxy), never a client-supplied X-Forwarded-For entry', async () => {
    primeVerified();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'req1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const req = mkReq(goodBody());
    req.headers['x-forwarded-for'] = '6.6.6.6, 1.2.3.4';
    await ctrl.signConsent(req, mkRes());
    const allParams = JSON.stringify(client.query.mock.calls.map(([, p]) => p));
    expect(allParams).not.toContain('6.6.6.6');
    expect(client.query.mock.calls[1][1]).toContain('1.2.3.4');
    expect(client.query.mock.calls[2][1]).toContain('1.2.3.4');
  });

  test('the sign claim also requires the token_hash that was looked up, so a superseded (resent) link cannot sign', async () => {
    primeVerified();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] }) // token was rotated by a resend between lookup and claim
      .mockResolvedValueOnce({});
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody()), res);
    const [claimSql, claimParams] = client.query.mock.calls[1];
    const m = /\btoken_hash = \$(\d+)/.exec(claimSql);
    expect(m).not.toBeNull();
    expect(claimParams[Number(m[1]) - 1]).toBe(sha256('tok'));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.query.mock.calls.some(([s]) => /INSERT INTO records_consents/.test(s))).toBe(false);
  });

  test('400 when typedName is longer than 120 characters, before any lookup', async () => {
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody({ typedName: 'A'.repeat(121) })), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/120/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('accepts a typedName of exactly 120 characters', async () => {
    primeVerified();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'req1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody({ typedName: 'A'.repeat(120) })), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('a second sign on an already-signed request is 409 and creates nothing', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row({ status: 'signed', consent_id: 77 })] });
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody()), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(callsMatching(CLAIM_SQL)).toHaveLength(0);
  });

  test('a concurrent sign that loses the claim race rolls back with 409 and inserts nothing', async () => {
    primeVerified();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // claim lost
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody()), res);
    expect(res.status).toHaveBeenCalledWith(409);
    const sqls = client.query.mock.calls.map(([s]) => s);
    expect(sqls.some((s) => /INSERT INTO records_consents/.test(s))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('an insert failure rolls back (request stays pending) and returns 500', async () => {
    primeVerified();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'req1' }] })
      .mockRejectedValueOnce(new Error('constraint'))
      .mockResolvedValueOnce({});
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody()), res);
    expect(client.query.mock.calls.map(([s]) => s)).toContain('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('wrong DOB on sign: 403, nothing created', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] });
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody({ dob: '2020-01-01' })), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('400 when the consent expiry date has already passed', async () => {
    primeVerified(row({ consent_expires_at: new Date(Date.now() - 1000).toISOString() }));
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody()), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test.each([
    ['cancelled', row({ status: 'cancelled' })],
    ['expired', row({ request_expires_at: new Date(Date.now() - 1000).toISOString() })],
    ['unknown / other tenant', null],
  ])('404 for a %s link', async (_l, r) => {
    pool.query.mockResolvedValueOnce({ rows: r ? [r] : [] });
    const res = mkRes();
    await ctrl.signConsent(mkReq(goodBody()), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

// A consent REQUEST never authorizes a disclosure; only the records_consents
// row created at signing time does. checkConsent reads records_consents
// only, so a pending request (which writes nothing there) leaves it ok:false
// and the row inserted by signConsent is exactly what makes it ok:true.
describe('pending request vs signed consent through checkConsent', () => {
  test('checkConsent never reads records_consent_requests', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await checkConsent(42, 'ABC Billing', ['sevf_forms'], 'billing@abc.org');
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM records_consents\s/);
    expect(sql).not.toMatch(/records_consent_requests/);
  });

  test('pending request => ok:false; after signing => ok:true via the inserted consent row', async () => {
    // Tiny in-memory records_consents table that applies checkConsent's
    // documented WHERE clause, fed only by what signConsent inserts.
    const consents = [];
    const fakeCheck = (sql, params) => {
      const [patientId, recipient, types, email] = params;
      const hit = consents.find((c) => c.patient_id === patientId
        && c.recipient_name.toLowerCase() === recipient.toLowerCase()
        && (!email || (c.recipient_email || '').toLowerCase() === email.toLowerCase())
        && !c.revoked_at && new Date(c.expires_at) > new Date()
        && types.every((t) => c.record_types.includes(t)));
      return { rows: hit ? [{ id: hit.id }] : [] };
    };

    // While only the request exists, nothing is in records_consents.
    pool.query.mockImplementationOnce(fakeCheck);
    expect((await checkConsent(42, 'ABC Billing', ['sevf_forms'], 'billing@abc.org')).ok).toBe(false);

    primeSign();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'req1' }] })
      .mockImplementationOnce((sql, p) => {
        consents.push({ id: 77, patient_id: p[0], recipient_name: p[1], recipient_email: p[2], record_types: p[4], expires_at: p[6], revoked_at: null });
        return { rows: [{ id: 77 }] };
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    await ctrl.signConsent(mkReq({ dob: '2024-03-05', typedName: 'Pat Parent', attested: true }), mkRes());

    pool.query.mockImplementationOnce(fakeCheck);
    expect(await checkConsent(42, 'ABC Billing', ['sevf_forms'], 'billing@abc.org')).toEqual({ ok: true, consentId: 77 });
  });

  function primeSign() {
    pool.query.mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
  }
});

describe('signConsent: parent manage link and staff notice', () => {
  const goodBody = () => ({ dob: '2024-03-05', typedName: 'Pat Parent', attested: true });
  const primeSigned = () => {
    pool.query
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    client.query
      .mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ id: 'req1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] }).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({});
  };
  const req = () => ({ ...mkReq(goodBody()), protocol: 'https', get: () => 'api.example.com' });

  test('stores only the hash of a fresh manage token and emails the raw one to the parent', async () => {
    primeSigned();
    const res = mkRes();
    await ctrl.signConsent(req(), res);

    const claimParams = client.query.mock.calls[1][1];
    const hash = claimParams[5]; // the manage_token_hash param (the looked-up token_hash is [4])
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(claimParams[4]);
    const [to, opts] = sendConsentManageEmail.mock.calls[0];
    expect(to).toBe('p@x.com');
    expect(opts.manageUrl).toMatch(/^https:\/\/api\.example\.com\/api\/consent-manage\/acme\/[a-f0-9]{64}$/);
    expect(sha256(opts.manageUrl.split('/').pop())).toBe(hash);
    expect(JSON.stringify(claimParams)).not.toContain(opts.manageUrl.split('/').pop());
  });

  test('hands the staff notice to the role-aware notifier, for the person who requested the consent', async () => {
    primeSigned();
    await ctrl.signConsent(req(), mkRes());
    expect(notifyConsentStaff).toHaveBeenCalledWith('signed', 7);
  });

  test('email failures never undo or fail the signing', async () => {
    primeSigned();
    sendConsentManageEmail.mockRejectedValue(new Error('down'));
    const res = mkRes();
    await ctrl.signConsent(req(), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});
