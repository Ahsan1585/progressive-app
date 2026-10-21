jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../middleware/tenantMiddleware', () => ({ lookupCompanyBySlug: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({ sendPasswordResetEmail: jest.fn(), sendInviteEmail: jest.fn() }));
jest.mock('../../utils/fieldEncryption', () => ({ encryptField: jest.fn(), decryptField: jest.fn() }));
jest.mock('bcryptjs', () => ({ compare: jest.fn(), genSalt: jest.fn(), hash: jest.fn() }));

process.env.JWT_SECRET = 'test-secret';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { encryptField, decryptField } = require('../../utils/fieldEncryption');
const { generateSecret, generateTotp, hashRecoveryCode } = require('../../utils/totp');
const auth = require('../authController');

function routeDb(routes) {
  pool.query.mockImplementation((sql, params) => {
    for (const [pattern, result] of routes) {
      if (pattern.test(sql)) {
        const value = typeof result === 'function' ? result(sql, params) : result;
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}
const callsMatching = (pattern) => pool.query.mock.calls.filter(([sql]) => pattern.test(sql));
const firstCallIndex = (pattern) => pool.query.mock.calls.findIndex(([sql]) => pattern.test(sql));
const missingTableError = () => Object.assign(new Error('relation "mfa_trusted_devices" does not exist'), { code: '42P01' });
const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const company = { slug: 'acme', tenant_db_name: 'tenant_acme', account_type: 'tenant' };
const secret = generateSecret();
const baseUser = {
  id: 7, email: 'pat@acme.com', role: 'practitioner', first_name: 'Pat', last_name: 'Lee',
  password_hash: 'hash', is_active: true, requires_password_change: false,
  mfa_enabled: false, mfa_secret: null, mfa_pending_secret: null, mfa_recovery_hashes: null,
  mfa_last_used_step: null, mfa_failed_attempts: 0, mfa_locked_until: null,
};
const enrolled = { ...baseUser, mfa_enabled: true, mfa_secret: `enc:${secret}` };
const mfaClaims = (stage) => ({ purpose: 'mfa', stage, practitionerId: 7, email: 'pat@acme.com', role: 'practitioner', slug: 'acme', tenantDb: 'tenant_acme', accountType: 'tenant' });

const INSERT_DEVICE = /INSERT INTO mfa_trusted_devices/;
const CONSUME_DEVICE = /UPDATE mfa_trusted_devices SET last_used_at/;
const REVOKE_ALL = /UPDATE mfa_trusted_devices SET revoked_at = now\(\)\s+WHERE practitioner_id = \$1 AND revoked_at IS NULL/;

beforeEach(() => {
  encryptField.mockImplementation((v) => (v == null ? v : `enc:${v}`));
  decryptField.mockImplementation((v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v));
});
afterEach(() => jest.resetAllMocks());

describe('verifyMfa + rememberDevice', () => {
  const verifyReq = (body) => ({ body, mfaChallenge: mfaClaims('verify'), practitioner: mfaClaims('verify'), headers: { 'user-agent': UA } });
  const okRoutes = () => [
    [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
    [/SET mfa_last_used_step/, { rows: [{ id: 7 }] }],
    [INSERT_DEVICE, (sql, params) => ({ rows: [{ id: 'dev-1', label: params[2] }] })],
  ];

  test('a valid code with rememberDevice mints a token, stores only its hash, and audits id + label', async () => {
    routeDb(okRoutes());
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret), rememberDevice: true }), res);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: true, token: expect.any(String), practitioner: { id: 7 } });
    expect(body.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The new row's id, so the client can mark "this device" in the list.
    expect(body.deviceId).toBe('dev-1');
    expect(new Date(body.deviceTokenExpiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
    const [, params] = callsMatching(INSERT_DEVICE)[0];
    expect(params).toContain(sha256(body.deviceToken));
    expect(params).not.toContain(body.deviceToken);
    expect(params).toContain('Chrome on Windows');
    const audit = logAudit.mock.calls.map(([a]) => a).find((a) => a.action === 'mfa_device_trusted');
    expect(audit.details).toEqual({ deviceId: 'dev-1', label: 'Chrome on Windows' });
  });

  test('a recovery code with rememberDevice also mints a token', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...enrolled, mfa_recovery_hashes: [hashRecoveryCode('abcde-fghij')] }] }],
      [/array_remove\(mfa_recovery_hashes/, { rows: [{ remaining: 0 }] }],
      [INSERT_DEVICE, { rows: [{ id: 'dev-2', label: 'Chrome on Windows' }] }],
    ]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ recoveryCode: 'abcde-fghij', rememberDevice: true }), res);
    expect(res.json.mock.calls[0][0].deviceToken).toEqual(expect.any(String));
  });

  test('no token without rememberDevice: true (absent, false, or a truthy non-true value)', async () => {
    for (const rememberDevice of [undefined, false, 'true', 1]) {
      routeDb(okRoutes());
      const res = makeRes();
      await auth.verifyMfa(verifyReq({ code: generateTotp(secret), rememberDevice }), res);
      const body = res.json.mock.calls[0][0];
      expect(body.token).toEqual(expect.any(String));
      expect(body.deviceToken).toBeUndefined();
      expect(body.deviceTokenExpiresAt).toBeUndefined();
      expect(body.deviceId).toBeUndefined();
      expect(callsMatching(INSERT_DEVICE)).toHaveLength(0);
      jest.resetAllMocks();
      decryptField.mockImplementation((v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v));
    }
  });

  test('a failed verify never returns or stores a device token', async () => {
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/SET mfa_last_used_step/, { rows: [] }],
    ]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret), rememberDevice: true }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].deviceToken).toBeUndefined();
    expect(callsMatching(INSERT_DEVICE)).toHaveLength(0);
  });

  test('a locked account with rememberDevice gets 429 and no token', async () => {
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [{ ...enrolled, mfa_locked_until: new Date(Date.now() + 60000) }] }]]);
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret), rememberDevice: true }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(callsMatching(INSERT_DEVICE)).toHaveLength(0);
  });

  test('if storing the device fails, login still succeeds without a device token', async () => {
    routeDb([...okRoutes().slice(0, 2), [INSERT_DEVICE, new Error('no table')]]);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret), rememberDevice: true }), res);
    const body = res.json.mock.calls[0][0];
    expect(res.status).not.toHaveBeenCalled();
    expect(body.token).toEqual(expect.any(String));
    expect(body.deviceToken).toBeUndefined();
  });

  test('caps active trusted devices at 10 per user (revokes the oldest beyond that)', async () => {
    routeDb(okRoutes());
    const res = makeRes();
    await auth.verifyMfa(verifyReq({ code: generateTotp(secret), rememberDevice: true }), res);
    const [sql, params] = callsMatching(/OFFSET/)[0];
    expect(sql).toMatch(/UPDATE mfa_trusted_devices SET revoked_at = now\(\)/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params).toEqual([7, 10]);
  });
});

describe('enableMfa + rememberDevice', () => {
  const ENABLE_WRITE = /SET mfa_secret = mfa_pending_secret/;
  const newSecret = generateSecret();
  const pending = { ...baseUser, mfa_pending_secret: `enc:${newSecret}` };
  const sessionReq = (body) => ({ body: { password: 'pw', ...body }, practitioner: { practitionerId: 7 }, headers: { 'user-agent': UA } });
  const enrollReq = (body) => ({ body, mfaChallenge: mfaClaims('enroll'), practitioner: mfaClaims('enroll'), headers: { 'user-agent': UA } });
  const okRoutes = (user = pending) => [
    [/SELECT \* FROM practitioners WHERE id/, { rows: [user] }],
    [ENABLE_WRITE, { rows: [{ id: 7 }] }],
    [INSERT_DEVICE, (sql, params) => ({ rows: [{ id: 'dev-9', label: params[2] }] })],
  ];
  const styles = [['session', sessionReq], ['enroll mfaToken', enrollReq]];

  test.each(styles)('(%s) mints a trusted device next to the recovery codes, hash-only, labelled, audited', async (style, makeReq) => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb(okRoutes());
    const res = makeRes();
    await auth.enableMfa(makeReq({ code: generateTotp(newSecret), rememberDevice: true }), res);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.deviceId).toBe('dev-9');
    expect(new Date(body.deviceTokenExpiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
    expect(new Date(body.deviceTokenExpiresAt).getTime()).toBeLessThan(Date.now() + 31 * 86400000);
    if (style === 'enroll mfaToken') {
      expect(body).toMatchObject({ success: true, token: expect.any(String), practitioner: { id: 7 } });
    } else {
      expect(body.token).toBeUndefined();
    }
    const [, params] = callsMatching(INSERT_DEVICE)[0];
    expect(params).toContain(sha256(body.deviceToken));
    expect(params).not.toContain(body.deviceToken);
    expect(params).toContain('Chrome on Windows');
    expect(callsMatching(/OFFSET/)[0][1]).toEqual([7, 10]);
    const audit = logAudit.mock.calls.map(([a]) => a).find((a) => a.action === 'mfa_device_trusted');
    expect(audit.details).toEqual({ deviceId: 'dev-9', label: 'Chrome on Windows' });
  });

  test.each(styles)('(%s) the device is minted AFTER the revoke-all and the enable write', async (_style, makeReq) => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb(okRoutes());
    await auth.enableMfa(makeReq({ code: generateTotp(newSecret), rememberDevice: true }), makeRes());
    expect(firstCallIndex(REVOKE_ALL)).toBeGreaterThanOrEqual(0);
    expect(firstCallIndex(INSERT_DEVICE)).toBeGreaterThan(firstCallIndex(REVOKE_ALL));
    expect(firstCallIndex(INSERT_DEVICE)).toBeGreaterThan(firstCallIndex(ENABLE_WRITE));
  });

  test.each(styles)('(%s) no device without rememberDevice: true', async (_style, makeReq) => {
    for (const rememberDevice of [undefined, false, 'true', 1]) {
      bcrypt.compare.mockResolvedValue(true);
      routeDb(okRoutes());
      const res = makeRes();
      await auth.enableMfa(makeReq({ code: generateTotp(newSecret), rememberDevice }), res);
      const body = res.json.mock.calls[0][0];
      expect(body.recoveryCodes).toHaveLength(10);
      expect(body.deviceToken).toBeUndefined();
      expect(body.deviceTokenExpiresAt).toBeUndefined();
      expect(body.deviceId).toBeUndefined();
      expect(callsMatching(INSERT_DEVICE)).toHaveLength(0);
      jest.resetAllMocks();
      decryptField.mockImplementation((v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v));
      encryptField.mockImplementation((v) => (v == null ? v : `enc:${v}`));
    }
  });

  test.each(styles)('(%s) a wrong code mints nothing', async (_style, makeReq) => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb(okRoutes());
    const res = makeRes();
    const wrong = generateTotp(newSecret) === '000000' ? '111111' : '000000';
    await auth.enableMfa(makeReq({ code: wrong, rememberDevice: true }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].deviceToken).toBeUndefined();
    expect(callsMatching(INSERT_DEVICE)).toHaveLength(0);
  });

  test('a failed enable write (concurrent setup) mints nothing', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/SELECT \* FROM practitioners WHERE id/, { rows: [pending] }], [ENABLE_WRITE, { rows: [] }]]);
    const res = makeRes();
    await auth.enableMfa(sessionReq({ code: generateTotp(newSecret), rememberDevice: true }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(callsMatching(INSERT_DEVICE)).toHaveLength(0);
  });

  test.each(styles)('(%s) if minting throws, enable still succeeds without a device token', async (style, makeReq) => {
    bcrypt.compare.mockResolvedValue(true);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    routeDb([...okRoutes().slice(0, 2), [INSERT_DEVICE, new Error('no table')]]);
    const res = makeRes();
    await auth.enableMfa(makeReq({ code: generateTotp(newSecret), rememberDevice: true }), res);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.deviceToken).toBeUndefined();
    expect(body.deviceId).toBeUndefined();
    if (style === 'enroll mfaToken') expect(body.token).toEqual(expect.any(String));
    expect(console.error).toHaveBeenCalled();
  });

  test('a support impersonation session is still refused, nothing minted', async () => {
    routeDb(okRoutes());
    const res = makeRes();
    await auth.enableMfa({ body: { code: generateTotp(newSecret), password: 'pw', rememberDevice: true }, practitioner: { practitionerId: 7, impersonation: { platformAdminEmail: 'x' } }, headers: { 'user-agent': UA } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('loginPractitioner + deviceToken', () => {
  const loginReq = (extra = {}) => ({ body: { email: 'pat@acme.com', password: 'pw', slug: 'acme', ...extra }, company, headers: { 'user-agent': UA } });

  test('a valid trusted device for this user skips the MFA step, stamps last_used_at, audits', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [enrolled] }],
      [CONSUME_DEVICE, { rows: [{ id: 'dev-1', label: 'Chrome on Windows' }] }],
    ]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq({ deviceToken: 'good-token' }), res);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: true, token: expect.any(String), practitioner: { id: 7 } });
    expect(body.mfaRequired).toBeUndefined();
    expect(jwt.verify(body.token, 'test-secret').purpose).toBeUndefined();
    const [sql, params] = callsMatching(CONSUME_DEVICE)[0];
    expect(sql).toMatch(/practitioner_id = \$1 AND token_hash = \$2 AND revoked_at IS NULL AND expires_at > now\(\)/);
    expect(params).toEqual([7, sha256('good-token')]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_trusted_device_used', details: { deviceId: 'dev-1', label: 'Chrome on Windows' } }));
  });

  test('another user\'s / expired / revoked token (no matching active row for THIS user) falls through with clearDeviceToken', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [enrolled] }],
      [CONSUME_DEVICE, { rows: [] }],
    ]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq({ deviceToken: 'someone-elses' }), res);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['clearDeviceToken', 'mfaRequired', 'mfaToken']);
    expect(body).toMatchObject({ mfaRequired: true, clearDeviceToken: true });
    expect(jwt.verify(body.mfaToken, 'test-secret')).toMatchObject({ stage: 'verify' });
    expect(callsMatching(/SET last_activity_at/)).toHaveLength(0);
    // Always scoped to this account's id, so a token for another account never matches.
    expect(callsMatching(CONSUME_DEVICE)[0][1][0]).toBe(7);
  });

  test('a garbage deviceToken falls through with clearDeviceToken and never hits the DB', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/FROM practitioners WHERE email/, { rows: [enrolled] }]]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq({ deviceToken: { $ne: null } }), res);
    expect(res.json.mock.calls[0][0]).toMatchObject({ mfaRequired: true, clearDeviceToken: true });
    expect(callsMatching(CONSUME_DEVICE)).toHaveLength(0);
  });

  test('a DB error on lookup falls through to the plain mfaRequired response (no clear)', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [enrolled] }],
      [CONSUME_DEVICE, new Error('no table')],
    ]);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await auth.loginPractitioner(loginReq({ deviceToken: 'tok' }), res);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['mfaRequired', 'mfaToken']);
  });

  test('no deviceToken: unchanged mfaRequired response, no device lookup', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([[/FROM practitioners WHERE email/, { rows: [enrolled] }]]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq(), res);
    expect(Object.keys(res.json.mock.calls[0][0]).sort()).toEqual(['mfaRequired', 'mfaToken']);
    expect(callsMatching(/mfa_trusted_devices/)).toHaveLength(0);
  });

  test('a locked account is never skipped even with a valid device; token is left alone', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [{ ...enrolled, mfa_locked_until: new Date(Date.now() + 60000) }] }],
      [CONSUME_DEVICE, { rows: [{ id: 'dev-1', label: 'L' }] }],
    ]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq({ deviceToken: 'good-token' }), res);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['mfaRequired', 'mfaToken']);
    expect(callsMatching(CONSUME_DEVICE)).toHaveLength(0);
  });

  test('enrollment-required users are never skipped by a device token', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [baseUser] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: true }] }],
      [CONSUME_DEVICE, { rows: [{ id: 'dev-1', label: 'L' }] }],
    ]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq({ deviceToken: 'good-token' }), res);
    const body = res.json.mock.calls[0][0];
    expect(body.mfaEnrollmentRequired).toBe(true);
    expect(body.token).toBeUndefined();
    expect(callsMatching(CONSUME_DEVICE)).toHaveLength(0);
  });

  test('wrong password with a valid device token is still 400', async () => {
    bcrypt.compare.mockResolvedValue(false);
    routeDb([
      [/FROM practitioners WHERE email/, { rows: [enrolled] }],
      [CONSUME_DEVICE, { rows: [{ id: 'dev-1', label: 'L' }] }],
    ]);
    const res = makeRes();
    await auth.loginPractitioner(loginReq({ deviceToken: 'good-token' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(callsMatching(CONSUME_DEVICE)).toHaveLength(0);
  });
});

describe('revocation of all trusted devices', () => {
  test('changeTemporaryPassword revokes all devices for the caller', async () => {
    bcrypt.genSalt.mockResolvedValue('s');
    bcrypt.hash.mockResolvedValue('newhash');
    routeDb([]);
    const res = makeRes();
    await auth.changeTemporaryPassword({ body: { newPassword: 'Str0ng!Pass' }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(callsMatching(REVOKE_ALL)).toHaveLength(1);
    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual([7]);
  });

  const PASSWORD_WRITE = /UPDATE practitioners\s+SET password_hash/;
  const resetTokenRow = () => ({ rows: [{ id: 7, email: 'pat@acme.com', reset_token_expires: new Date(Date.now() + 60000) }] });

  test('changeTemporaryPassword revokes before the password write', async () => {
    bcrypt.genSalt.mockResolvedValue('s');
    bcrypt.hash.mockResolvedValue('newhash');
    routeDb([]);
    await auth.changeTemporaryPassword({ body: { newPassword: 'Str0ng!Pass' }, practitioner: { practitionerId: 7 }, headers: {} }, makeRes());
    expect(firstCallIndex(REVOKE_ALL)).toBeGreaterThanOrEqual(0);
    expect(firstCallIndex(REVOKE_ALL)).toBeLessThan(firstCallIndex(PASSWORD_WRITE));
  });

  test('changeTemporaryPassword/resetPassword treat a missing trusted-device table (42P01) as nothing to revoke', async () => {
    bcrypt.genSalt.mockResolvedValue('s');
    bcrypt.hash.mockResolvedValue('newhash');
    routeDb([
      [REVOKE_ALL, missingTableError()],
      [/WHERE reset_token_hash = \$1/, resetTokenRow()],
    ]);
    const res1 = makeRes();
    await auth.changeTemporaryPassword({ body: { newPassword: 'Str0ng!Pass' }, practitioner: { practitionerId: 7 }, headers: {} }, res1);
    expect(res1.status).not.toHaveBeenCalled();
    expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const res2 = makeRes();
    await auth.resetPassword({ body: { token: 'abc', newPassword: 'Str0ng!Pass' }, headers: {} }, res2);
    expect(res2.status).not.toHaveBeenCalled();
    expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(callsMatching(PASSWORD_WRITE)).toHaveLength(2);
  });

  test('changeTemporaryPassword/resetPassword fail (500) without writing the password on any other revoke error', async () => {
    bcrypt.genSalt.mockResolvedValue('s');
    bcrypt.hash.mockResolvedValue('newhash');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    routeDb([
      [REVOKE_ALL, new Error('connection reset')],
      [/WHERE reset_token_hash = \$1/, resetTokenRow()],
    ]);
    const res1 = makeRes();
    await auth.changeTemporaryPassword({ body: { newPassword: 'Str0ng!Pass' }, practitioner: { practitionerId: 7 }, headers: {} }, res1);
    expect(res1.status).toHaveBeenCalledWith(500);
    const res2 = makeRes();
    await auth.resetPassword({ body: { token: 'abc', newPassword: 'Str0ng!Pass' }, headers: {} }, res2);
    expect(res2.status).toHaveBeenCalledWith(500);
    expect(callsMatching(PASSWORD_WRITE)).toHaveLength(0);
  });

  test('activateAccount: a revoke failure is non-fatal (a brand-new account has no devices)', async () => {
    bcrypt.genSalt.mockResolvedValue('s');
    bcrypt.hash.mockResolvedValue('newhash');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    routeDb([
      [/WHERE reset_token_hash = \$1 AND password_hash = \$2/, resetTokenRow()],
      [REVOKE_ALL, new Error('connection reset')],
    ]);
    const res = makeRes();
    await auth.activateAccount({ params: { token: 'abc' }, body: { newPassword: 'Str0ng!Pass' }, headers: {} }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(callsMatching(PASSWORD_WRITE)).toHaveLength(1);
  });

  test('resetPassword revokes all devices for the reset user', async () => {
    bcrypt.genSalt.mockResolvedValue('s');
    bcrypt.hash.mockResolvedValue('newhash');
    routeDb([[/WHERE reset_token_hash = \$1/, { rows: [{ id: 7, reset_token_expires: new Date(Date.now() + 60000) }] }]]);
    const res = makeRes();
    await auth.resetPassword({ body: { token: 'abc', newPassword: 'Str0ng!Pass' }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual([7]);
  });

  test('an invalid reset link revokes nothing', async () => {
    routeDb([[/WHERE reset_token_hash = \$1/, { rows: [] }]]);
    const res = makeRes();
    await auth.resetPassword({ body: { token: 'abc', newPassword: 'Str0ng!Pass' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(callsMatching(REVOKE_ALL)).toHaveLength(0);
  });

  test('disableMfa revokes all devices', async () => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: false }] }],
    ]);
    const res = makeRes();
    await auth.disableMfa({ body: { password: 'pw', code: generateTotp(secret) }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual([7]);
  });

  test('a refused disableMfa revokes nothing', async () => {
    bcrypt.compare.mockResolvedValue(false);
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [enrolled] }],
      [/mfa_required FROM company_settings/, { rows: [{ mfa_required: false }] }],
    ]);
    const res = makeRes();
    await auth.disableMfa({ body: { password: 'nope', code: generateTotp(secret) }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(callsMatching(REVOKE_ALL)).toHaveLength(0);
  });

  const ENABLE_WRITE = /SET mfa_secret = mfa_pending_secret/;
  const newSecret = generateSecret();
  const enableCases = [
    ['replacement', { ...enrolled, mfa_pending_secret: `enc:${newSecret}` }],
    ['first-time enable', { ...baseUser, mfa_pending_secret: `enc:${newSecret}` }],
  ];

  test.each(enableCases)('enableMfa (%s) revokes all devices BEFORE writing the new secret/recovery codes', async (_name, user) => {
    bcrypt.compare.mockResolvedValue(true);
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [user] }],
      [ENABLE_WRITE, { rows: [{ id: 7 }] }],
    ]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: generateTotp(newSecret), password: 'pw' }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.json.mock.calls[0][0].recoveryCodes).toHaveLength(10);
    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual([7]);
    expect(firstCallIndex(REVOKE_ALL)).toBeLessThan(firstCallIndex(ENABLE_WRITE));
  });

  test.each(enableCases)('enableMfa (%s): if the revoke throws, 500 with no secret/recovery-code write', async (_name, user) => {
    bcrypt.compare.mockResolvedValue(true);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    routeDb([
      [/SELECT \* FROM practitioners WHERE id/, { rows: [user] }],
      [REVOKE_ALL, new Error('connection reset')],
      [ENABLE_WRITE, { rows: [{ id: 7 }] }],
    ]);
    const res = makeRes();
    await auth.enableMfa({ body: { code: generateTotp(newSecret), password: 'pw' }, practitioner: { practitionerId: 7 }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(callsMatching(ENABLE_WRITE)).toHaveLength(0);
    expect(callsMatching(/mfa_recovery_hashes/)).toHaveLength(0);
  });

  const MFA_CLEAR = /UPDATE practitioners SET mfa_enabled = false/;
  const TARGET_LOOKUP = /SELECT id FROM practitioners WHERE id = \$1 AND is_platform_support = false/;
  const resetReq = { params: { id: '9' }, practitioner: { practitionerId: 1, role: 'ceo' }, body: {}, headers: {} };

  test('resetStaffMfa (admin) revokes all of the target\'s devices BEFORE clearing MFA', async () => {
    routeDb([
      [TARGET_LOOKUP, { rows: [{ id: 9 }] }],
      [MFA_CLEAR, { rows: [{ id: 9 }] }],
    ]);
    const res = makeRes();
    await auth.resetStaffMfa(resetReq, res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual(['9']);
    expect(firstCallIndex(REVOKE_ALL)).toBeLessThan(firstCallIndex(MFA_CLEAR));
  });

  test('resetStaffMfa: if the revoke throws, 500 and MFA is NOT cleared', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    routeDb([
      [TARGET_LOOKUP, { rows: [{ id: 9 }] }],
      [REVOKE_ALL, new Error('connection reset')],
      [MFA_CLEAR, { rows: [{ id: 9 }] }],
    ]);
    const res = makeRes();
    await auth.resetStaffMfa(resetReq, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(callsMatching(MFA_CLEAR)).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('resetStaffMfa on an unknown (or platform-support) account revokes nothing', async () => {
    routeDb([[TARGET_LOOKUP, { rows: [] }], [MFA_CLEAR, { rows: [{ id: 9 }] }]]);
    const res = makeRes();
    await auth.resetStaffMfa({ params: { id: '9' }, practitioner: { practitionerId: 1, role: 'ceo' }, body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(callsMatching(REVOKE_ALL)).toHaveLength(0);
  });

  test('deactivating a staff member revokes their devices', async () => {
    routeDb([
      [/SELECT role FROM practitioners/, { rows: [{ role: 'practitioner' }] }],
      [/admin_count/, { rows: [] }],
    ]);
    const res = makeRes();
    await auth.deleteStaffMember({ params: { id: '42' }, practitioner: { practitionerId: 1, role: 'ceo' }, isAdmin: true, permissions: new Set() }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual(['42']);
    expect(firstCallIndex(REVOKE_ALL)).toBeLessThan(firstCallIndex(/SET is_active = false/));
    expect(firstCallIndex(REVOKE_ALL)).toBeLessThan(firstCallIndex(/UPDATE patient_practitioners/));
  });

  const staffReq = { params: { id: '42' }, practitioner: { practitionerId: 1, role: 'ceo' }, isAdmin: true, permissions: new Set() };

  test('deactivation: if the revoke throws, 500 with no is_active or caseload change', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    routeDb([
      [/SELECT role FROM practitioners/, { rows: [{ role: 'practitioner' }] }],
      [/admin_count/, { rows: [] }],
      [REVOKE_ALL, new Error('connection reset')],
    ]);
    const res = makeRes();
    await auth.deleteStaffMember(staffReq, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(callsMatching(/SET is_active = false/)).toHaveLength(0);
    expect(callsMatching(/patient_practitioners/)).toHaveLength(0);
  });

  test('reactivating a staff member revokes their devices BEFORE setting is_active', async () => {
    routeDb([[/SELECT role FROM practitioners/, { rows: [{ role: 'practitioner' }] }]]);
    const res = makeRes();
    await auth.reactivateStaffMember(staffReq, res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual(['42']);
    expect(firstCallIndex(REVOKE_ALL)).toBeLessThan(firstCallIndex(/SET is_active = true/));
  });

  test('reactivation: if the revoke throws, 500 and the account stays inactive', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    routeDb([
      [/SELECT role FROM practitioners/, { rows: [{ role: 'practitioner' }] }],
      [REVOKE_ALL, new Error('connection reset')],
    ]);
    const res = makeRes();
    await auth.reactivateStaffMember(staffReq, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(callsMatching(/SET is_active = true/)).toHaveLength(0);
  });
});

describe('trusted device management endpoints', () => {
  const sessionReq = (extra = {}) => ({ practitioner: { practitionerId: 7, email: 'pat@acme.com', role: 'practitioner' }, params: {}, body: {}, headers: {}, ...extra });
  const impersonating = (extra = {}) => sessionReq({ practitioner: { practitionerId: 7, impersonation: { platformAdminEmail: 'x' } }, ...extra });

  test('GET lists only the caller\'s active devices, never the hash', async () => {
    const created = new Date('2026-10-01T00:00:00Z');
    routeDb([[/FROM mfa_trusted_devices/, { rows: [{ id: 'dev-1', label: 'Chrome on Windows', created_at: created, last_used_at: null, expires_at: created, token_hash: 'SHOULD-NOT-LEAK' }] }]]);
    const res = makeRes();
    await auth.listTrustedDevices(sessionReq(), res);
    expect(res.json).toHaveBeenCalledWith({ devices: [{ id: 'dev-1', label: 'Chrome on Windows', createdAt: created, lastUsedAt: null, expiresAt: created }] });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/token_hash|\*/);
    expect(sql).toMatch(/practitioner_id = \$1 AND revoked_at IS NULL AND expires_at > now\(\)/);
    expect(params).toEqual([7]);
  });

  test('DELETE /:id revokes only the caller\'s own device and audits', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    routeDb([[/UPDATE mfa_trusted_devices SET revoked_at = now\(\)\s+WHERE id = \$1 AND practitioner_id = \$2/, { rows: [{ id, label: 'L' }] }]]);
    const res = makeRes();
    await auth.revokeTrustedDevice(sessionReq({ params: { id } }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(pool.query.mock.calls[0][1]).toEqual([id, 7]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_device_revoked', details: { deviceId: id, label: 'L' } }));
  });

  test('DELETE /:id for another user\'s device (no row matched) or a non-uuid id is 404, no audit', async () => {
    routeDb([[/UPDATE mfa_trusted_devices/, { rows: [] }]]);
    for (const id of ['11111111-2222-4333-8444-555555555555', 'not-a-uuid']) {
      const res = makeRes();
      await auth.revokeTrustedDevice(sessionReq({ params: { id } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(pool.query).toHaveBeenCalledTimes(1); // the non-uuid never reaches the DB
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('DELETE (all) revokes every device for the caller and audits', async () => {
    routeDb([[REVOKE_ALL, { rowCount: 3 }]]);
    const res = makeRes();
    await auth.revokeAllTrustedDevicesForSelf(sessionReq(), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual([7]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_device_revoked', details: { all: true, count: 3 } }));
  });

  test('all three refuse a support impersonation session without touching the DB', async () => {
    for (const fn of [auth.listTrustedDevices, auth.revokeTrustedDevice, auth.revokeAllTrustedDevicesForSelf]) {
      const res = makeRes();
      await fn(impersonating({ params: { id: '11111111-2222-4333-8444-555555555555' } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
});
