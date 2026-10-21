jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../middleware/tenantMiddleware', () => ({ lookupCompanyBySlug: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({ sendPasswordResetEmail: jest.fn(), sendInviteEmail: jest.fn() }));
jest.mock('../../utils/fieldEncryption', () => ({
  encryptField: jest.fn((v) => (v == null ? v : `enc:${v}`)),
  decryptField: jest.fn((v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v)),
}));
jest.mock('bcryptjs', () => ({ compare: jest.fn(), genSalt: jest.fn(), hash: jest.fn() }));

process.env.JWT_SECRET = 'test-secret';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { encryptField } = require('../../utils/fieldEncryption');
const { generateSecret, generateTotp, hashRecoveryCode } = require('../../utils/totp');
const auth = require('../authController');

// Route pool.query by SQL text rather than call order, so a handler adding
// or reordering a harmless query doesn't silently shift every mock.
function routeDb(routes) {
  pool.query.mockImplementation((sql, params) => {
    for (const [pattern, result] of routes) {
      if (pattern.test(sql)) {
        const value = typeof result === 'function' ? result(sql, params) : result;
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      }
    }
    return Promise.resolve({ rows: [] });
  });
}

const callsMatching = (pattern) => pool.query.mock.calls.filter(([sql]) => pattern.test(sql));

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const company = { slug: 'acme', tenant_db_name: 'tenant_acme', account_type: 'tenant' };
const baseUser = {
  id: 7, email: 'pat@acme.com', role: 'practitioner', first_name: 'Pat', last_name: 'Lee',
  password_hash: 'hash', is_active: true, requires_password_change: false,
  mfa_enabled: false, mfa_secret: null, mfa_pending_secret: null, mfa_recovery_hashes: null,
  mfa_last_used_step: null, mfa_failed_attempts: 0, mfa_locked_until: null,
};
const mfaClaims = (stage) => ({ purpose: 'mfa', stage, practitionerId: 7, email: 'pat@acme.com', role: 'practitioner', slug: 'acme', tenantDb: 'tenant_acme', accountType: 'tenant' });

// resetAllMocks also wipes the factory implementations above, so the fake
// encryption pair is re-installed before every test.
const { decryptField } = require('../../utils/fieldEncryption');
beforeEach(() => {
  encryptField.mockImplementation((v) => (v == null ? v : `enc:${v}`));
  decryptField.mockImplementation((v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v));
});
afterEach(() => jest.resetAllMocks());

describe('loginPractitioner with MFA', () => {
  const loginReq = () => ({ body: { email: 'pat@acme.com', password: 'pw', slug: 'acme' }, company, headers: {} });

  test('no MFA anywhere: unchanged success payload, and last_activity_at is stamped', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [baseUser] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: false }] }],
    ]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({
      success: true, message: 'Login successful', token: expect.any(String),
      practitioner: { id: 7, firstName: 'Pat', lastName: 'Lee', email: 'pat@acme.com', role: 'practitioner' },
      requirePasswordChange: false,
    });
    const decoded = jwt.verify(body.token, 'test-secret');
    expect(decoded).toMatchObject({ practitionerId: 7, slug: 'acme', tenantDb: 'tenant_acme', accountType: 'tenant' });
    expect(decoded.purpose).toBeUndefined();
    expect(callsMatching(/SET last_activity_at = now\(\)/)).toHaveLength(1);
  });

  test('a failing last_activity_at write does not fail login', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [baseUser] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: false }] }],
      [/SET last_activity_at/, new Error('db hiccup')],
    ]);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await auth.loginPractitioner(loginReq(), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].token).toEqual(expect.any(String));
  });

  test('an enrolled user gets { mfaRequired, mfaToken } and no session token', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/FROM practitioners WHERE email/, { rows: [{ ...baseUser, mfa_enabled: true, mfa_secret: 'enc:X' }] }]]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['mfaRequired', 'mfaToken']);
    expect(body.mfaRequired).toBe(true);
    const decoded = jwt.verify(body.mfaToken, 'test-secret');
    expect(decoded).toMatchObject({ purpose: 'mfa', stage: 'verify', practitionerId: 7, tenantDb: 'tenant_acme' });
    expect(decoded.exp - decoded.iat).toBe(600);
    expect(callsMatching(/SET last_activity_at/)).toHaveLength(0);
  });

  test('company requires MFA and user not enrolled: { mfaEnrollmentRequired, mfaToken }', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [baseUser] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: true }] }],
    ]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['mfaEnrollmentRequired', 'mfaToken']);
    expect(jwt.verify(body.mfaToken, 'test-secret')).toMatchObject({ purpose: 'mfa', stage: 'enroll' });
  });

  test('wrong password never reaches the MFA step', async () => {
    bcrypt.compare.mockResolvedValue(false);
    routeDb([[/FROM practitioners WHERE email/, { rows: [{ ...baseUser, mfa_enabled: true }] }]]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].mfaToken).toBeUndefined();
  });
});

describe('verifyMfa', () => {
  const secret = generateSecret();
  const enrolled = { ...baseUser, mfa_enabled: true, mfa_secret: `enc:${secret}` };
  const verifyReq = (body) => ({ body, mfaChallenge: mfaClaims('verify'), practitioner: mfaClaims('verify'), headers: {} });

  test('a valid code returns the full login payload and records the used step', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/SET mfa_last_used_step/, { rows: [{ id: 7 }] }],
    ]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret) }), res);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: true, token: expect.any(String), practitioner: { id: 7 }, requirePasswordChange: false });
    expect(jwt.verify(body.token, 'test-secret').purpose).toBeUndefined();
    expect(callsMatching(/SET mfa_last_used_step/)).toHaveLength(1);
    expect(callsMatching(/SET last_activity_at = now\(\)/)).toHaveLength(1);
  });

  test('a code that loses the replay race (UPDATE matched no row) is rejected', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/SET mfa_last_used_step/, { rows: [] }],
    ]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('a wrong code bumps the failure counter, audits, and returns 400', async () => {
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }]]);
    const res = makeRes();
    const wrong = generateTotp(secret) === '000000' ? '111111' : '000000';
    await auth.verifyMfa(verifyReq({ code: wrong }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].token).toBeUndefined();
    expect(callsMatching(/mfa_failed_attempts = mfa_failed_attempts \+ 1/)).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_verify_failed' }));
  });

  test('a locked account gets 429 even with a correct code', async () => {
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...enrolled, mfa_locked_until: new Date(Date.now() + 60000) }] }]]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret) }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(callsMatching(/SET mfa_last_used_step/)).toHaveLength(0);
  });

  test('a recovery code is consumed atomically and audited', async () => {
    const recovery = 'abcde-fghij';
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...enrolled, mfa_recovery_hashes: [hashRecoveryCode(recovery)] }] }],
      [/array_remove\(mfa_recovery_hashes/, { rows: [{ remaining: 0 }] }],
    ]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ recoveryCode: 'ABCDE FGHIJ' }), res);
    expect(res.json.mock.calls[0][0].token).toEqual(expect.any(String));
    const [, params] = callsMatching(/array_remove\(mfa_recovery_hashes/)[0];
    expect(params).toEqual([7, hashRecoveryCode(recovery)]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_recovery_code_used' }));
  });

  test('an unknown/used recovery code fails', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/array_remove\(mfa_recovery_hashes/, { rows: [] }],
    ]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ recoveryCode: 'zzzzz-zzzzz' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_verify_failed' }));
  });

  test('a deactivated user is refused', async () => {
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...enrolled, is_active: false }] }]]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret) }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('setupMfa', () => {
  const sessionReq = (body) => ({ body, practitioner: { practitionerId: 7 }, headers: {} });
  const enrollReq = (body) => ({ body, mfaChallenge: mfaClaims('enroll'), practitioner: mfaClaims('enroll'), headers: {} });

  test('stores an encrypted pending secret and returns secret + otpauth URI', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [baseUser] }]]);
    const res = makeRes();
    await auth.setupMfa(sessionReq({ password: 'pw' }), res);
    const body = res.json.mock.calls[0][0];
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.otpauthUri).toBe(`otpauth://totp/Izaya%20EIS:pat%40acme.com?secret=${body.secret}&issuer=Izaya%20EIS&algorithm=SHA1&digits=6&period=30`);
    expect(encryptField).toHaveBeenCalledWith(body.secret);
    const [, params] = callsMatching(/SET mfa_pending_secret = \$2/)[0];
    expect(params).toEqual([7, `enc:${body.secret}`]);
    expect(callsMatching(/mfa_enabled = true/)).toHaveLength(0);
    expect(bcrypt.compare).toHaveBeenCalledWith('pw', 'hash');
  });

  test('with a plain session, a missing or wrong password is 400 "Password is incorrect." and counts as a failure', async () => {
    for (const body of [{}, { password: 'nope' }]) {
      bcrypt.compare.mockResolvedValue(false);
      routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [baseUser] }]]);
      const res = makeRes();
      await auth.setupMfa(sessionReq(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Password is incorrect.' });
      expect(callsMatching(/SET mfa_pending_secret/)).toHaveLength(0);
      expect(callsMatching(/mfa_failed_attempts = mfa_failed_attempts \+ 1/)).toHaveLength(1);
      jest.resetAllMocks();
    }
  });

  test('a locked account is refused (429) before the password is even checked', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...baseUser, mfa_locked_until: new Date(Date.now() + 60000) }] }]]);
    const res = makeRes();
    await auth.setupMfa(sessionReq({ password: 'pw' }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(callsMatching(/SET mfa_pending_secret/)).toHaveLength(0);
  });

  test('the enroll-stage mfaToken (forced enrollment right after password login) needs no password', async () => {
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [baseUser] }]]);
    const res = makeRes();
    await auth.setupMfa(enrollReq({}), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('refuses (409) when MFA is already enabled and no re-auth is supplied, so a stolen session cannot re-enroll', async () => {
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...baseUser, mfa_enabled: true }] }]]);
    const res = makeRes();
    await auth.setupMfa({ body: {}, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  describe('replacing the authenticator on an enabled account', () => {
    const oldSecret = generateSecret();
    const enrolled = { ...baseUser, mfa_enabled: true, mfa_secret: `enc:${oldSecret}`, mfa_recovery_hashes: [hashRecoveryCode('abcde-fghij')] };

    test('password + current valid code: stores a NEW pending secret, keeps MFA on, consumes the step atomically', async () => {
      bcrypt.compare.mockResolvedValue(true);
      routeDb([
        [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
        [/SET mfa_last_used_step/, { rows: [{ id: 7 }] }],
      ]);
      const res = makeRes();
      await auth.setupMfa(sessionReq({ password: 'pw', code: generateTotp(oldSecret) }), res);
      expect(res.status).not.toHaveBeenCalled();
      const body = res.json.mock.calls[0][0];
      expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(body.secret).not.toBe(oldSecret);
      const [sql, params] = callsMatching(/SET mfa_last_used_step/)[0];
      expect(sql).toMatch(/mfa_pending_secret = \$3/);
      expect(sql).toMatch(/mfa_last_used_step IS NULL OR mfa_last_used_step < \$2/);
      expect(params[2]).toBe(`enc:${body.secret}`);
      expect(callsMatching(/mfa_enabled = false/)).toHaveLength(0);
      expect(callsMatching(/mfa_secret = /)).toHaveLength(0);
    });

    test('password + unused recovery code works and consumes the recovery code', async () => {
      bcrypt.compare.mockResolvedValue(true);
      routeDb([
        [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
        [/array_remove\(mfa_recovery_hashes/, { rows: [{ remaining: 0 }] }],
      ]);
      const res = makeRes();
      await auth.setupMfa(sessionReq({ password: 'pw', recoveryCode: 'ABCDE-FGHIJ' }), res);
      expect(res.status).not.toHaveBeenCalled();
      const body = res.json.mock.calls[0][0];
      const [sql, params] = callsMatching(/array_remove\(mfa_recovery_hashes/)[0];
      expect(sql).toMatch(/mfa_pending_secret = \$3/);
      expect(params).toEqual([7, hashRecoveryCode('abcde-fghij'), `enc:${body.secret}`]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_recovery_code_used' }));
    });

    test('wrong password: 400 "Password is incorrect.", counted, nothing stored', async () => {
      bcrypt.compare.mockResolvedValue(false);
      routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }]]);
      const res = makeRes();
      await auth.setupMfa(sessionReq({ password: 'nope', code: generateTotp(oldSecret) }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Password is incorrect.' });
      expect(callsMatching(/mfa_pending_secret/)).toHaveLength(0);
      expect(callsMatching(/mfa_failed_attempts = mfa_failed_attempts \+ 1/)).toHaveLength(1);
    });

    test('right password but wrong/replayed code: 400, counted, nothing stored', async () => {
      bcrypt.compare.mockResolvedValue(true);
      routeDb([
        [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
        [/SET mfa_last_used_step/, { rows: [] }],
      ]);
      const res = makeRes();
      await auth.setupMfa(sessionReq({ password: 'pw', code: generateTotp(oldSecret) }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid verification code.' });
      expect(callsMatching(/mfa_failed_attempts = mfa_failed_attempts \+ 1/)).toHaveLength(1);
    });

    test('password alone (no code) is not enough', async () => {
      bcrypt.compare.mockResolvedValue(true);
      routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }]]);
      const res = makeRes();
      await auth.setupMfa(sessionReq({ password: 'pw' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(callsMatching(/mfa_pending_secret/)).toHaveLength(0);
    });

    test('an enroll-stage mfaToken can never replace an enabled authenticator', async () => {
      routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }]]);
      const res = makeRes();
      await auth.setupMfa(enrollReq({ code: generateTotp(oldSecret) }), res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(callsMatching(/mfa_pending_secret/)).toHaveLength(0);
    });

    test('a locked account gets 429', async () => {
      bcrypt.compare.mockResolvedValue(true);
      routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...enrolled, mfa_locked_until: new Date(Date.now() + 60000) }] }]]);
      const res = makeRes();
      await auth.setupMfa(sessionReq({ password: 'pw', code: generateTotp(oldSecret) }), res);
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  test('refuses during a support impersonation session', async () => {
    const res = makeRes();
    await auth.setupMfa({ body: {}, practitioner: { practitionerId: 7, impersonation: { platformAdminEmail: 'x' } }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('enableMfa', () => {
  const secret = generateSecret();
  const pending = { ...baseUser, mfa_pending_secret: `enc:${secret}` };

  test('with a session: enables, returns 10 recovery codes, no session token', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [pending] }],
      [/SET mfa_secret = mfa_pending_secret/, { rows: [{ id: 7 }] }],
    ]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: generateTotp(secret), password: 'pw' }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.token).toBeUndefined();
    const [sql, params] = callsMatching(/SET mfa_secret = mfa_pending_secret/)[0];
    expect(sql).toMatch(/mfa_enabled = true/);
    expect(params[1]).toEqual(body.recoveryCodes.map(hashRecoveryCode));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_enabled' }));
  });

  test('with an enrollment mfaToken: also returns the full login payload', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [pending] }],
      [/SET mfa_secret = mfa_pending_secret/, { rows: [{ id: 7 }] }],
    ]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: generateTotp(secret) }, mfaChallenge: mfaClaims('enroll'), practitioner: mfaClaims('enroll'), headers: {} }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body).toMatchObject({ success: true, token: expect.any(String), practitioner: { id: 7 } });
    expect(jwt.verify(body.token, 'test-secret')).toMatchObject({ practitionerId: 7, tenantDb: 'tenant_acme', accountType: 'tenant' });
  });

  test('a wrong code does not enable', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [pending] }]]);
    const res = makeRes();
    const wrong = generateTotp(secret) === '000000' ? '111111' : '000000';
    await auth.enableMfa({ body: { code: wrong, password: 'pw' }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(callsMatching(/SET mfa_secret = mfa_pending_secret/)).toHaveLength(0);
  });

  test('without a pending secret: 400', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [baseUser] }]]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: '123456', password: 'pw' }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('with a plain session, a wrong/missing password is 400 "Password is incorrect.", counted, and does not enable', async () => {
    for (const body of [{ code: generateTotp(secret) }, { code: generateTotp(secret), password: 'nope' }]) {
      bcrypt.compare.mockResolvedValue(false);
      routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [pending] }]]);
      const res = makeRes();
      await auth.enableMfa({ body, practitioner: { practitionerId: 7 }, headers: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Password is incorrect.' });
      expect(callsMatching(/SET mfa_secret = mfa_pending_secret/)).toHaveLength(0);
      expect(callsMatching(/mfa_failed_attempts = mfa_failed_attempts \+ 1/)).toHaveLength(1);
      jest.resetAllMocks();
    }
  });

  test('the enroll-stage mfaToken path needs no password', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [pending] }],
      [/SET mfa_secret = mfa_pending_secret/, { rows: [{ id: 7 }] }],
    ]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: generateTotp(secret) }, mfaChallenge: mfaClaims('enroll'), practitioner: mfaClaims('enroll'), headers: {} }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('replacement: on an enabled account with a pending secret, swaps in the new secret, rotates recovery codes, resets counters', async () => {
    const oldSecret = generateSecret();
    const replacing = { ...baseUser, mfa_enabled: true, mfa_secret: `enc:${oldSecret}`, mfa_pending_secret: `enc:${secret}`, mfa_recovery_hashes: ['old'], mfa_failed_attempts: 2 };
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [replacing] }],
      [/SET mfa_secret = mfa_pending_secret/, { rows: [{ id: 7 }] }],
    ]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: generateTotp(secret), password: 'pw' }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.token).toBeUndefined();
    const [sql, params] = callsMatching(/SET mfa_secret = mfa_pending_secret/)[0];
    expect(sql).toMatch(/mfa_pending_secret = NULL/);
    expect(sql).toMatch(/mfa_failed_attempts = 0/);
    expect(sql).toMatch(/mfa_locked_until = NULL/);
    expect(params[1]).toEqual(body.recoveryCodes.map(hashRecoveryCode));
    // Guarded on exactly the pending secret that was just verified.
    expect(params).toContain(`enc:${secret}`);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_authenticator_replaced' }));
  });

  test('replacement: an enabled account with NO pending secret still gets the 409', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...baseUser, mfa_enabled: true, mfa_secret: 'enc:X' }] }]]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: '123456', password: 'pw' }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('replacement is never possible with an enroll-stage mfaToken', async () => {
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...baseUser, mfa_enabled: true, mfa_secret: 'enc:X', mfa_pending_secret: `enc:${secret}` }] }]]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: generateTotp(secret) }, mfaChallenge: mfaClaims('enroll'), practitioner: mfaClaims('enroll'), headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(callsMatching(/SET mfa_secret = mfa_pending_secret/)).toHaveLength(0);
  });
});

describe('resetStaffMfa (admin)', () => {
  const req = (id, practitionerId = 1) => ({ params: { id }, practitioner: { practitionerId, role: 'ceo' }, body: {}, headers: {} });

  test('clears every MFA column for the target and audits mfa_reset_by_admin with the target id only', async () => {
    routeDb([
      [/SELECT id FROM practitioners WHERE id = \$1 AND is_platform_support = false/, { rows: [{ id: 9 }] }],
      [/UPDATE practitioners SET mfa_enabled = false/, { rows: [{ id: 9 }] }],
    ]);
    const res = makeRes();
    await auth.resetStaffMfa(req('9'), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    const [sql, params] = callsMatching(/UPDATE practitioners SET mfa_enabled = false/)[0];
    for (const col of ['mfa_secret = NULL', 'mfa_pending_secret = NULL', 'mfa_recovery_hashes = NULL', 'mfa_last_used_step = NULL', 'mfa_failed_attempts = 0', 'mfa_locked_until = NULL']) {
      expect(sql).toContain(col);
    }
    expect(sql).toMatch(/WHERE id = \$1/);
    expect(params).toEqual(['9']);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_reset_by_admin', resourceId: '9' }));
    const auditArg = logAudit.mock.calls[0][0];
    expect(JSON.stringify(auditArg.details || {})).not.toMatch(/@|Pat|Lee/);
    // Ends nothing else: no is_active / session / password change.
    expect(callsMatching(/is_active|password_hash|last_activity_at/)).toHaveLength(0);
  });

  test('refuses to reset yourself (400) without touching the DB', async () => {
    const res = makeRes();
    await auth.resetStaffMfa(req('1', 1), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('404 for a nonexistent id (or a non-numeric one), no audit', async () => {
    for (const id of ['999', 'abc']) {
      routeDb([[/UPDATE practitioners SET mfa_enabled = false/, { rows: [] }]]);
      const res = makeRes();
      await auth.resetStaffMfa(req(id), res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(logAudit).not.toHaveBeenCalled();
      jest.resetAllMocks();
    }
  });
});

describe('getAllStaff MFA flag', () => {
  test('returns a boolean mfa_enabled per staff member, never the secret or hashes', async () => {
    routeDb([[/FROM practitioners p/, { rows: [{ id: 1, mfa_enabled: true }, { id: 2, mfa_enabled: false }] }]]);
    const res = makeRes();
    await auth.getAllStaff({ practitioner: { practitionerId: 1 } }, res);
    expect(res.json).toHaveBeenCalledWith({ staff: [{ id: 1, mfa_enabled: true }, { id: 2, mfa_enabled: false }] });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(p\.mfa_enabled, false\) AS mfa_enabled/);
    expect(sql).not.toMatch(/mfa_secret|mfa_pending_secret|mfa_recovery_hashes|p\.\*/);
  });
});

describe('disableMfa', () => {
  const secret = generateSecret();
  const enrolled = { ...baseUser, mfa_enabled: true, mfa_secret: `enc:${secret}` };
  const req = (body) => ({ body, practitioner: { practitionerId: 7 }, headers: {} });

  test('403 when the company requires MFA', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: true }] }],
    ]);
    bcrypt.compare.mockResolvedValue(true);
    const res = makeRes();
    await auth.disableMfa(req({ password: 'pw', code: generateTotp(secret) }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(callsMatching(/mfa_enabled = false/)).toHaveLength(0);
  });

  test('wrong password is refused', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: false }] }],
    ]);
    bcrypt.compare.mockResolvedValue(false);
    const res = makeRes();
    await auth.disableMfa(req({ password: 'nope', code: generateTotp(secret) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(callsMatching(/mfa_enabled = false/)).toHaveLength(0);
  });

  test('password + valid code disables and clears secrets', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: false }] }],
    ]);
    bcrypt.compare.mockResolvedValue(true);
    const res = makeRes();
    await auth.disableMfa(req({ password: 'pw', code: generateTotp(secret) }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    const [sql] = callsMatching(/mfa_enabled = false/)[0];
    expect(sql).toMatch(/mfa_secret = NULL/);
    expect(sql).toMatch(/mfa_recovery_hashes = NULL/);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_disabled' }));
  });
});

describe('getMe MFA fields', () => {
  test('returns mfaEnabled and companyMfaRequired', async () => {
    routeDb([[/company_mfa_required/, { rows: [{ mfa_enabled: true, company_mfa_required: true }] }]]);
    const res = makeRes();
    await auth.getMe({ practitioner: { practitionerId: 7, role: 'practitioner' }, isAdmin: false, permissions: new Set() }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mfaEnabled: true, companyMfaRequired: true, roleName: 'Practitioner' }));
  });

  test('defaults both to false if the lookup fails, rather than breaking /me', async () => {
    routeDb([[/company_mfa_required/, new Error('boom')]]);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await auth.getMe({ practitioner: { practitionerId: 7, role: 'practitioner' }, isAdmin: false, permissions: new Set() }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mfaEnabled: false, companyMfaRequired: false }));
  });
});
