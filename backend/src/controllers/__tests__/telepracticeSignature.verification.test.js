jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({ sendParentSignatureRequestEmail: jest.fn() }));
jest.mock('../../constants/dropdownOptionsCache', () => ({ ensureDropdownOptionsCacheLoaded: jest.fn(), getDropdownOptionsCache: () => ({}) }));
jest.mock('../../config/tenantContext', () => ({ getCurrentTenantDb: jest.fn() }));
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const ctrl = require('../telepracticeSignatureController');

const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() });
const baseRow = (o = {}) => ({
  id: 'req1', status: 'awaiting_signature', token_expires: new Date(Date.now() + 1e6).toISOString(),
  patient_dob: '2024-03-05', patient_first_name: 'Kid', verify_failed_attempts: 0, verify_locked_at: null,
  parent_email: 'p@x.com', ...o,
});
const mkReq = (body = {}) => ({ params: { token: 'tok', companySlug: 's' }, body, headers: { 'user-agent': 'UA' }, ip: '1.2.3.4' });

afterEach(() => jest.resetAllMocks());

describe('getTelepracticeSignatureSummary', () => {
  it('returns no session details, only requiresVerification', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow()] });
    const res = mkRes();
    await ctrl.getTelepracticeSignatureSummary(mkReq(), res);
    expect(res.json.mock.calls[0][0]).toEqual({ success: true, requiresVerification: true });
  });
  it('reports locked generically', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow({ verify_locked_at: new Date().toISOString() })] });
    const res = mkRes();
    await ctrl.getTelepracticeSignatureSummary(mkReq(), res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json.mock.calls[0][0].error).toBe('locked');
  });
});

// The attempt is claimed up front by ONE conditional UPDATE (lock check +
// counter + lock-at-5 in a single statement), before the DOB is compared,
// so parallel requests can never get more than 5 guesses between them.
const CLAIM_SQL = /SET verify_failed_attempts = verify_failed_attempts \+ 1/;
const RESET_SQL = /SET verify_failed_attempts = 0/;
const callsMatching = (re) => pool.query.mock.calls.filter(([sql]) => re.test(sql));

describe('verifyTelepracticeSignatureIdentity', () => {
  it('returns summary and attestation text on correct DOB, and resets the counter', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await ctrl.verifyTelepracticeSignatureIdentity(mkReq({ dob: '2024-03-05' }), res);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.summary.childName).toBe('Kid');
    expect(body.attestationText).toBe(ctrl.ATTESTATION_TEXT);
    expect(callsMatching(CLAIM_SQL)).toHaveLength(1);
    expect(callsMatching(RESET_SQL)).toHaveLength(1);
  });
  it('the attempt is claimed atomically BEFORE the DOB is compared', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    await ctrl.verifyTelepracticeSignatureIdentity(mkReq({ dob: '2024-03-05' }), mkRes());
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(CLAIM_SQL);
    expect(sql).toMatch(/verify_locked_at IS NULL/);
    expect(sql).toMatch(/verify_failed_attempts < \$\d/);
    expect(sql).toMatch(/token_hash = \$\d/);
    expect(sql).toMatch(/verify_locked_at = CASE WHEN verify_failed_attempts \+ 1 >= \$\d THEN now\(\)/);
    expect(sql).toMatch(/RETURNING/);
    expect(params).toEqual(expect.arrayContaining(['req1', 5]));
  });
  it('a lost claim (a parallel request used up the last attempt) is locked even with the correct DOB', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow({ verify_failed_attempts: 4 })] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mkRes();
    await ctrl.verifyTelepracticeSignatureIdentity(mkReq({ dob: '2024-03-05' }), res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json.mock.calls[0][0]).toMatchObject({ error: 'locked' });
    expect(res.json.mock.calls[0][0].summary).toBeUndefined();
    expect(callsMatching(RESET_SQL)).toHaveLength(0);
  });
  it('wrong DOB: generic 403, no details', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow()] }).mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] });
    const res = mkRes();
    await ctrl.verifyTelepracticeSignatureIdentity(mkReq({ dob: '2020-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe('verification_failed');
    expect(JSON.stringify(body)).not.toMatch(/Kid|dob|birth/i);
    expect(logAudit).not.toHaveBeenCalled();
    expect(callsMatching(RESET_SQL)).toHaveLength(0);
  });
  it('5th failure locks the link and logs an audit event', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow({ verify_failed_attempts: 4 })] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 5, verify_locked_at: new Date().toISOString() }] });
    const res = mkRes();
    await ctrl.verifyTelepracticeSignatureIdentity(mkReq({ dob: '2020-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'telepractice_signature_locked' }));
  });
  it('a correct DOB on the 5th attempt still succeeds and clears the lock', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow({ verify_failed_attempts: 4 })] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 5, verify_locked_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await ctrl.verifyTelepracticeSignatureIdentity(mkReq({ dob: '2024-03-05' }), res);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    const [resetSql] = callsMatching(RESET_SQL)[0];
    expect(resetSql).toMatch(/verify_locked_at = NULL/);
    expect(logAudit).not.toHaveBeenCalled();
  });
  it('already-locked token rejects even a correct DOB', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow({ verify_locked_at: new Date().toISOString() })] });
    const res = mkRes();
    await ctrl.verifyTelepracticeSignatureIdentity(mkReq({ dob: '2024-03-05' }), res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json.mock.calls[0][0].summary).toBeUndefined();
  });
  it('malformed DOB counts as a failure', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow()] }).mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] });
    const res = mkRes();
    await ctrl.verifyTelepracticeSignatureIdentity(mkReq({ dob: 'nope' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('signTelepracticeSession', () => {
  const body = (o = {}) => ({ signatureBase64: 'sig', dob: '2024-03-05', attested: true, ...o });
  it('rejects without attestation=true (400) before touching the DB', async () => {
    for (const attested of [false, undefined, 'true']) {
      const res = mkRes();
      await ctrl.signTelepracticeSession(mkReq(body({ attested })), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('rejects a wrong DOB at sign time', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow()] }).mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] });
    const res = mkRes();
    await ctrl.signTelepracticeSession(mkReq(body({ dob: '1999-01-01' })), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it('stores attestation, ip, user agent and dob_verified_at on success', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await ctrl.signTelepracticeSession(mkReq(body()), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(callsMatching(CLAIM_SQL)).toHaveLength(1);
    const [sql, params] = callsMatching(/attested = true/)[0];
    expect(sql).toMatch(/attested = true/);
    expect(sql).toMatch(/dob_verified_at = now\(\)/);
    expect(params).toEqual(expect.arrayContaining(['sig', ctrl.ATTESTATION_TEXT, '1.2.3.4', 'UA']));
  });
  it('refuses a locked link', async () => {
    pool.query.mockResolvedValueOnce({ rows: [baseRow({ verify_locked_at: new Date().toISOString() })] });
    const res = mkRes();
    await ctrl.signTelepracticeSession(mkReq(body()), res);
    expect(res.status).toHaveBeenCalledWith(423);
  });
});

describe('resend resets the lock', () => {
  it('clears attempts and lock when a fresh link is issued', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'r', status: 'awaiting_signature', sent_at: new Date(0).toISOString(), parent_email: 'p@x.com' }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await ctrl.resendTelepracticeSignatureRequest({ params: { id: 'r' }, practitioner: { practitionerId: 1, slug: 's' } }, res);
    expect(pool.query.mock.calls[1][0]).toMatch(/verify_failed_attempts = 0/);
    expect(pool.query.mock.calls[1][0]).toMatch(/verify_locked_at = NULL/);
  });
});
