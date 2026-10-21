// Email-verified MFA self-recovery: a user who passed the password step but
// has neither their authenticator nor recovery codes asks for a one-time
// link to their own address; following it revokes every trusted device and
// then clears MFA so the next login goes through the normal (re-)enroll flow.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../middleware/tenantMiddleware', () => ({ lookupCompanyBySlug: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendInviteEmail: jest.fn(),
  sendMfaResetEmail: jest.fn(),
  sendMfaResetCompletedEmail: jest.fn(),
}));
jest.mock('../../utils/fieldEncryption', () => ({ encryptField: jest.fn(), decryptField: jest.fn() }));
jest.mock('bcryptjs', () => ({ compare: jest.fn(), genSalt: jest.fn(), hash: jest.fn() }));

process.env.JWT_SECRET = 'test-secret';

const crypto = require('crypto');
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { sendMfaResetEmail, sendMfaResetCompletedEmail } = require('../../utils/emailClient');
const auth = require('../authController');

function routeDb(routes) {
  // Transactions (pool.connect) run through the same routed mock.
  pool.connect.mockImplementation(() => Promise.resolve({ query: pool.query, release: jest.fn() }));
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
const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const mfaClaims = (stage) => ({ purpose: 'mfa', stage, practitionerId: 7, email: 'alex@gmail.com', role: 'ceo', slug: 'acme', tenantDb: 'tenant_acme', accountType: 'tenant' });
const user = { id: 7, email: 'alex@gmail.com', role: 'ceo', is_active: true, is_platform_support: false, mfa_enabled: true };

const LOAD_USER = /SELECT .* FROM practitioners WHERE id = \$1/s;
const INSERT_REQ = /INSERT INTO mfa_reset_requests/;
const INVALIDATE = /UPDATE mfa_reset_requests SET expires_at/;
const DELETE_REQ = /DELETE FROM mfa_reset_requests/;
const COMPANY_NAME = /SELECT display_name FROM company_settings/;
const CLAIM = /UPDATE mfa_reset_requests r SET used_at = now\(\)/;
const UNCLAIM = /UPDATE mfa_reset_requests SET used_at = NULL/;
const REVOKE_ALL = /UPDATE mfa_trusted_devices SET revoked_at = now\(\)/;
const CLEAR_MFA = /UPDATE practitioners SET mfa_enabled = false/;
const MFA_REQUIRED = /SELECT mfa_required FROM company_settings/;

afterEach(() => jest.resetAllMocks());

describe('maskEmail', () => {
  test('keeps the first character of the local part and the whole domain', () => {
    expect(auth.maskEmail('alex@gmail.com')).toBe('a***@gmail.com');
    expect(auth.maskEmail('a@x.org')).toBe('a***@x.org');
    expect(auth.maskEmail('Bob.Smith@sub.example.com')).toBe('B***@sub.example.com');
  });
});

describe('POST /mfa/recovery-email (requestMfaResetEmail)', () => {
  const req = (stage = 'verify') => ({ body: { mfaToken: 'x' }, mfaChallenge: mfaClaims(stage), practitioner: mfaClaims(stage), headers: {} });
  const okRoutes = () => [
    [LOAD_USER, { rows: [user] }],
    [INSERT_REQ, { rows: [{ id: 'req-1' }] }],
    [COMPANY_NAME, { rows: [{ display_name: 'Acme EI' }] }],
  ];

  test('stores only the token hash, emails a 30-minute link, and returns the masked email only', async () => {
    routeDb(okRoutes());
    sendMfaResetEmail.mockResolvedValue();
    const res = makeRes();
    await auth.requestMfaResetEmail(req(), res);

    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ success: true, maskedEmail: 'a***@gmail.com' });

    const [toEmail, opts] = sendMfaResetEmail.mock.calls[0];
    expect(toEmail).toBe('alex@gmail.com');
    const m = opts.resetUrl.match(/\/mfa-reset\/acme\/([0-9a-f]{64})$/);
    expect(m).not.toBeNull();
    const rawToken = m[1];
    expect(opts.resetUrl.startsWith(process.env.FRONTEND_URL || 'http://localhost:5173/eis')).toBe(true);

    const [insertSql, insertParams] = callsMatching(INSERT_REQ)[0];
    expect(insertParams).toContain(sha256(rawToken));
    expect(insertParams).not.toContain(rawToken);
    expect(insertSql).toMatch(/interval '30 minutes'/);
    // The raw token never goes back to the client.
    expect(JSON.stringify(body)).not.toContain(rawToken);

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_reset_requested', resourceType: 'auth', details: { requestId: 'req-1' } }));
  });

  test('invalidates the earlier unused requests only after the new email was sent', async () => {
    routeDb(okRoutes());
    sendMfaResetEmail.mockResolvedValue();
    await auth.requestMfaResetEmail(req(), makeRes());
    const [sql, params] = callsMatching(INVALIDATE)[0];
    expect(sql).toMatch(/used_at IS NULL/);
    expect(params).toEqual([7, 'req-1']);
    expect(sendMfaResetEmail.mock.invocationCallOrder[0]).toBeLessThan(pool.query.mock.invocationCallOrder[firstCallIndex(INVALIDATE)]);
  });

  test('the email carries no child data: only address, link and org name are passed', async () => {
    routeDb(okRoutes());
    sendMfaResetEmail.mockResolvedValue();
    await auth.requestMfaResetEmail(req(), makeRes());
    const [, opts] = sendMfaResetEmail.mock.calls[0];
    expect(Object.keys(opts).sort()).toEqual(['organizationName', 'resetUrl']);
    // No patient table is ever touched by this flow.
    expect(pool.query.mock.calls.some(([sql]) => /patients|sessions|session_logs/i.test(sql))).toBe(false);
  });

  test('the per-user hourly cap is enforced in the INSERT (3 per hour by created_at) and answers 429', async () => {
    routeDb([[LOAD_USER, { rows: [user] }], [INSERT_REQ, { rows: [] }]]);
    const res = makeRes();
    await auth.requestMfaResetEmail(req(), res);
    const [sql] = callsMatching(INSERT_REQ)[0];
    expect(sql).toMatch(/created_at > now\(\) - interval '1 hour'/);
    expect(sql).toMatch(/< 3/);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'Too many reset emails. Try again in an hour.' });
    expect(sendMfaResetEmail).not.toHaveBeenCalled();
  });

  test('a send failure answers 502 and deletes that request row', async () => {
    routeDb(okRoutes());
    sendMfaResetEmail.mockRejectedValue(new Error('Email is not configured'));
    const res = makeRes();
    await auth.requestMfaResetEmail(req(), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'We could not send the email. Please try again or contact your administrator.' });
    expect(callsMatching(DELETE_REQ)[0][1]).toEqual(['req-1']);
    expect(callsMatching(INVALIDATE)).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('defense in depth: an enroll-stage challenge (or none) is refused', async () => {
    for (const r of [req('enroll'), { body: {}, headers: {} }]) {
      const res = makeRes();
      await auth.requestMfaResetEmail(r, res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(pool.query).not.toHaveBeenCalled();
    expect(sendMfaResetEmail).not.toHaveBeenCalled();
  });

  test('deactivated and platform-support accounts get no email', async () => {
    for (const u of [{ ...user, is_active: false }, { ...user, is_platform_support: true }]) {
      routeDb([[LOAD_USER, { rows: [u] }]]);
      const res = makeRes();
      await auth.requestMfaResetEmail(req(), res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(sendMfaResetEmail).not.toHaveBeenCalled();
    expect(callsMatching(INSERT_REQ)).toHaveLength(0);
  });

  test('a practitioner gets a link into the mobile app, same as the password-reset link', async () => {
    routeDb([[LOAD_USER, { rows: [{ ...user, role: 'practitioner' }] }], [INSERT_REQ, { rows: [{ id: 'req-1' }] }]]);
    sendMfaResetEmail.mockResolvedValue();
    await auth.requestMfaResetEmail(req(), makeRes());
    expect(sendMfaResetEmail.mock.calls[0][1].resetUrl).toMatch(
      new RegExp(`^${(process.env.MOBILE_APP_URL || 'http://localhost:5174/EIS').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/mfa-reset/acme/[0-9a-f]{64}$`)
    );
  });

  test('blocked for 24 hours after a password change (mailbox-only takeover): 403, nothing stored or sent', async () => {
    routeDb([[LOAD_USER, { rows: [{ ...user, recent_password_change: true }] }]]);
    const res = makeRes();
    await auth.requestMfaResetEmail(req(), res);
    const [loadSql] = callsMatching(LOAD_USER)[0];
    expect(loadSql).toMatch(/password_changed_at > now\(\) - interval '24 hours'/);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'For your security, a two-step reset by email is not available for 24 hours after a password change. Use a recovery code, or ask an administrator to reset it.' });
    expect(callsMatching(INSERT_REQ)).toHaveLength(0);
    expect(sendMfaResetEmail).not.toHaveBeenCalled();
  });

  test('a NULL password_changed_at (never changed) is allowed', async () => {
    routeDb(okRoutes().map(([p, r]) => (p === LOAD_USER ? [p, { rows: [{ ...user, recent_password_change: false }] }] : [p, r])));
    sendMfaResetEmail.mockResolvedValue();
    const res = makeRes();
    await auth.requestMfaResetEmail(req(), res);
    const [loadSql] = callsMatching(LOAD_USER)[0];
    expect(loadSql).toMatch(/password_changed_at IS NOT NULL/);
    expect(res.json).toHaveBeenCalledWith({ success: true, maskedEmail: 'a***@gmail.com' });
  });

  test('the count-and-insert runs under a per-user advisory lock inside a transaction', async () => {
    const client = { query: jest.fn((sql) => Promise.resolve(INSERT_REQ.test(sql) ? { rows: [{ id: 'req-1' }] } : { rows: [] })), release: jest.fn() };
    routeDb([[LOAD_USER, { rows: [user] }]]);
    pool.connect.mockResolvedValue(client);
    sendMfaResetEmail.mockResolvedValue();
    await auth.requestMfaResetEmail(req(), makeRes());
    const sqls = client.query.mock.calls.map(([sql]) => sql);
    const iBegin = sqls.findIndex((s) => /^BEGIN/.test(s));
    const iLock = sqls.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    const iInsert = sqls.findIndex((s) => INSERT_REQ.test(s));
    const iCommit = sqls.findIndex((s) => /^COMMIT/.test(s));
    expect(iBegin).toBe(0);
    expect(iLock).toBeGreaterThan(iBegin);
    expect(iInsert).toBeGreaterThan(iLock);
    expect(iCommit).toBeGreaterThan(iInsert);
    expect(client.query.mock.calls[iLock][1]).toContain(7);
    expect(client.release).toHaveBeenCalled();
  });

  test('parallel requests cannot exceed 3 per hour (lock serializes the count and insert)', async () => {
    // A tiny fake DB: the advisory lock is a real mutex released at COMMIT/ROLLBACK.
    const rowsInDb = [];
    let lockTail = Promise.resolve();
    const makeClient = () => {
      let release = null;
      return {
        release: jest.fn(),
        query: jest.fn(async (sql, params) => {
          if (/pg_advisory_xact_lock/.test(sql)) {
            const prev = lockTail;
            lockTail = new Promise((r) => { release = r; });
            await prev;
            return { rows: [] };
          }
          if (INSERT_REQ.test(sql)) {
            const count = rowsInDb.length;
            await new Promise((r) => setImmediate(r)); // let others interleave
            if (count >= 3) return { rows: [] };
            const row = { id: `req-${rowsInDb.length + 1}`, practitioner_id: params[0] };
            rowsInDb.push(row);
            return { rows: [{ id: row.id }] };
          }
          if (/^(COMMIT|ROLLBACK)/.test(sql) && release) { release(); release = null; }
          return { rows: [] };
        }),
      };
    };
    routeDb([[LOAD_USER, { rows: [user] }]]);
    pool.connect.mockImplementation(() => Promise.resolve(makeClient()));
    sendMfaResetEmail.mockResolvedValue();
    const resps = Array.from({ length: 6 }, makeRes);
    await Promise.all(resps.map((r) => auth.requestMfaResetEmail(req(), r)));
    const statuses = resps.map((r) => (r.status.mock.calls[0] ? r.status.mock.calls[0][0] : 200));
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
    expect(rowsInDb).toHaveLength(3);
  });

  test('a failure expiring the older links after the send still returns success', async () => {
    routeDb([...okRoutes(), [INVALIDATE, new Error('db blip')]]);
    sendMfaResetEmail.mockResolvedValue();
    const res = makeRes();
    await auth.requestMfaResetEmail(req(), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, maskedEmail: 'a***@gmail.com' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_reset_requested' }));
  });
});

describe('POST /:companySlug/mfa-reset/:token (confirmMfaReset)', () => {
  const token = 'ab'.repeat(32);
  const req = (t = token) => ({ params: { companySlug: 'acme', token: t }, body: {}, headers: {}, company: { slug: 'acme' } });
  const claimed = { id: 'req-1', practitioner_id: 7, email: 'alex@gmail.com', role: 'ceo' };
  const okRoutes = (extra = []) => [
    ...extra,
    [CLAIM, { rows: [claimed] }],
    [REVOKE_ALL, { rows: [], rowCount: 2 }],
    [CLEAR_MFA, { rows: [{ id: 7 }] }],
    [MFA_REQUIRED, { rows: [{ mfa_required: true }] }],
  ];

  test('claims the request atomically by hash, revokes devices BEFORE clearing MFA, and reports the company MFA policy', async () => {
    routeDb(okRoutes());
    sendMfaResetCompletedEmail.mockResolvedValue();
    const res = makeRes();
    await auth.confirmMfaReset(req(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, companyRequiresMfa: true });

    const [claimSql, claimParams] = callsMatching(CLAIM)[0];
    expect(claimParams).toEqual([sha256(token)]);
    expect(claimSql).toMatch(/used_at IS NULL/);
    expect(claimSql).toMatch(/expires_at > now\(\)/);
    expect(claimSql).toMatch(/is_active = true/);
    expect(claimSql).toMatch(/is_platform_support = false/);
    expect(claimSql).toMatch(/RETURNING/);

    expect(callsMatching(REVOKE_ALL)[0][1]).toEqual([7]);
    expect(firstCallIndex(CLAIM)).toBeLessThan(firstCallIndex(REVOKE_ALL));
    expect(firstCallIndex(REVOKE_ALL)).toBeLessThan(firstCallIndex(CLEAR_MFA));
    const [clearSql, clearParams] = callsMatching(CLEAR_MFA)[0];
    for (const col of ['mfa_secret = NULL', 'mfa_pending_secret = NULL', 'mfa_recovery_hashes = NULL', 'mfa_last_used_step = NULL', 'mfa_failed_attempts = 0', 'mfa_locked_until = NULL']) {
      expect(clearSql).toContain(col);
    }
    expect(clearParams).toEqual([7]);

    expect(sendMfaResetCompletedEmail).toHaveBeenCalledWith('alex@gmail.com');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mfa_reset_via_email', resourceType: 'auth', actorId: 7, details: { requestId: 'req-1' } }));
  });

  test('companyRequiresMfa is false when the company does not require MFA', async () => {
    routeDb(okRoutes([[MFA_REQUIRED, { rows: [{ mfa_required: false }] }]]));
    const res = makeRes();
    await auth.confirmMfaReset(req(), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, companyRequiresMfa: false });
  });

  test('an invalid, expired, used, deactivated or support-account token is a generic 404 and changes nothing', async () => {
    routeDb([[CLAIM, { rows: [] }]]);
    const res = makeRes();
    await auth.confirmMfaReset(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'This reset link is no longer valid.' });
    expect(callsMatching(REVOKE_ALL)).toHaveLength(0);
    expect(callsMatching(CLEAR_MFA)).toHaveLength(0);
    expect(sendMfaResetCompletedEmail).not.toHaveBeenCalled();
  });

  test('a malformed token is a 404 without touching the database', async () => {
    const res = makeRes();
    await auth.confirmMfaReset(req('not-a-token'), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('single use under parallel confirms: only the first claim succeeds, the second gets 404', async () => {
    let claims = 0;
    routeDb(okRoutes([[CLAIM, () => (claims++ === 0 ? { rows: [claimed] } : { rows: [] })]]));
    const a = makeRes();
    const b = makeRes();
    await Promise.all([auth.confirmMfaReset(req(), a), auth.confirmMfaReset(req(), b)]);
    const statuses = [a, b].map((r) => (r.status.mock.calls[0] ? r.status.mock.calls[0][0] : 200)).sort();
    expect(statuses).toEqual([200, 404]);
    expect(callsMatching(CLEAR_MFA)).toHaveLength(1);
  });

  test('a revoke failure leaves MFA on and puts the request back to unused', async () => {
    routeDb(okRoutes([[REVOKE_ALL, new Error('db down')]]));
    const res = makeRes();
    await auth.confirmMfaReset(req(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(callsMatching(CLEAR_MFA)).toHaveLength(0);
    const [unclaimSql, unclaimParams] = callsMatching(UNCLAIM)[0];
    expect(unclaimSql).toMatch(/WHERE id = \$1/);
    expect(unclaimParams).toEqual(['req-1']);
    expect(logAudit).not.toHaveBeenCalled();
    expect(sendMfaResetCompletedEmail).not.toHaveBeenCalled();
  });

  test('the clear step also refuses a deactivated / support account (404) and unclaims', async () => {
    routeDb(okRoutes([[CLEAR_MFA, { rows: [] }]]));
    const res = makeRes();
    await auth.confirmMfaReset(req(), res);
    const [clearSql] = callsMatching(CLEAR_MFA)[0];
    expect(clearSql).toMatch(/is_active = true/);
    expect(clearSql).toMatch(/is_platform_support = false/);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(callsMatching(UNCLAIM)).toHaveLength(1);
  });

  test('a failed completion notice does not fail the reset', async () => {
    routeDb(okRoutes());
    sendMfaResetCompletedEmail.mockRejectedValue(new Error('smtp down'));
    const res = makeRes();
    await auth.confirmMfaReset(req(), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, companyRequiresMfa: true });
  });

  test('a link requested before a later password change (or within 24h of one) does not match the claim', async () => {
    routeDb(okRoutes());
    await auth.confirmMfaReset(req(), makeRes());
    const [claimSql] = callsMatching(CLAIM)[0];
    expect(claimSql).toMatch(/p\.password_changed_at IS NULL OR \(p\.password_changed_at < r\.created_at AND p\.password_changed_at <= now\(\) - interval '24 hours'\)/);
  });

  test('the token is never echoed back in the response', async () => {
    routeDb(okRoutes());
    const res = makeRes();
    await auth.confirmMfaReset(req(), res);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain(token);
  });
});

describe('password changes stamp password_changed_at and kill pending MFA reset links', () => {
  const bcrypt = require('bcryptjs');
  const STRONG = 'Str0ng!Passw0rd';
  const PASSWORD_WRITE = /UPDATE practitioners\s+SET password_hash/;
  const EXPIRE_PENDING = /UPDATE mfa_reset_requests SET used_at = now\(\)\s+WHERE practitioner_id = \$1 AND used_at IS NULL/;
  const future = new Date(Date.now() + 600000).toISOString();

  const cases = {
    resetPassword: {
      routes: [[/SELECT id, reset_token_expires FROM practitioners/, { rows: [{ id: 7, reset_token_expires: future }] }]],
      call: (res) => auth.resetPassword({ body: { token: 'tok', newPassword: STRONG } }, res),
    },
    changeTemporaryPassword: {
      routes: [],
      call: (res) => auth.changeTemporaryPassword({ body: { newPassword: STRONG }, practitioner: { practitionerId: 7 } }, res),
    },
    activateAccount: {
      routes: [[/SELECT id, email, reset_token_expires FROM practitioners/, { rows: [{ id: 7, email: 'a@x.com', reset_token_expires: future }] }]],
      call: (res) => auth.activateAccount({ params: { token: 'tok' }, body: { newPassword: STRONG } }, res),
    },
  };

  beforeEach(() => {
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockResolvedValue('newhash');
  });

  for (const [name, c] of Object.entries(cases)) {
    test(`${name}: sets password_changed_at = now() and marks unused reset requests used, after the password write`, async () => {
      routeDb([...c.routes, [PASSWORD_WRITE, { rows: [], rowCount: 1 }]]);
      const res = makeRes();
      await c.call(res);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      const [writeSql] = callsMatching(PASSWORD_WRITE)[0];
      expect(writeSql).toMatch(/password_changed_at = now\(\)/);
      const expire = callsMatching(EXPIRE_PENDING);
      expect(expire).toHaveLength(1);
      expect(expire[0][1]).toEqual([7]);
      expect(firstCallIndex(PASSWORD_WRITE)).toBeLessThan(firstCallIndex(EXPIRE_PENDING));
    });

    test(`${name}: a failure expiring the reset links does not block the password change`, async () => {
      routeDb([...c.routes, [PASSWORD_WRITE, { rows: [], rowCount: 1 }], [EXPIRE_PENDING, new Error('relation does not exist')]]);
      const res = makeRes();
      await c.call(res);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  }
});
