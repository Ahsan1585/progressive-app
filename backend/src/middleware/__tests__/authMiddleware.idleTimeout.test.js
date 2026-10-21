jest.mock('jsonwebtoken', () => ({ verify: jest.fn(), sign: jest.fn() }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantPoolRegistry', () => ({ getTenantPool: jest.fn() }));
jest.mock('../../config/tenantContext', () => ({ runWithTenant: jest.fn((tenantDb, fn) => fn()) }));
jest.mock('../../constants/dropdownOptionsCache', () => ({ ensureDropdownOptionsCacheLoaded: jest.fn().mockResolvedValue() }));

const jwt = require('jsonwebtoken');
const { platformPool } = require('../../config/platformDb');
const { getTenantPool } = require('../../config/tenantPoolRegistry');
const { protect } = require('../authMiddleware');

const MIN = 60 * 1000;
const nowSec = () => Math.floor(Date.now() / 1000);

describe('protect: server-side idle timeout', () => {
  const originalIdle = process.env.SESSION_IDLE_MINUTES;
  afterEach(() => {
    // clearAllMocks, not reset: reset would also wipe the factory-provided
    // runWithTenant / dropdown-cache implementations above.
    jest.clearAllMocks();
    if (originalIdle === undefined) delete process.env.SESSION_IDLE_MINUTES;
    else process.env.SESSION_IDLE_MINUTES = originalIdle;
  });

  const validCompanyRow = { status: 'active', trial_ends_at: null, baa_accepted_at: new Date() };

  function setup({ lastActivityAt, iat = nowSec() - 2 * 3600, updateImpl, decodedExtra = {} }) {
    jwt.verify.mockReturnValue({ practitionerId: 7, role: 'practitioner', slug: 'acme', tenantDb: 'tenant_acme', iat, ...decodedExtra });
    platformPool.query.mockResolvedValue({ rows: [validCompanyRow] });
    const tenantPool = {
      query: jest.fn((sql) => {
        if (/^\s*UPDATE/i.test(sql)) return updateImpl ? updateImpl() : Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{ is_active: true, last_activity_at: lastActivityAt }] });
      }),
    };
    getTenantPool.mockReturnValue(tenantPool);
    return tenantPool;
  }

  async function run() {
    const req = { headers: { authorization: 'Bearer faketoken' }, originalUrl: '/api/patients' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await new Promise((resolve) => {
      protect(req, res, next);
      setImmediate(resolve);
    });
    return { req, res, next };
  }

  const updateCalls = (pool) => pool.query.mock.calls.filter(([sql]) => /^\s*UPDATE/i.test(sql));

  test('rejects with 401 when last activity is older than the default 30 minutes', async () => {
    setup({ lastActivityAt: new Date(Date.now() - 31 * MIN) });
    const { res, next } = await run();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Your session expired due to inactivity. Please log in again.' });
    expect(next).not.toHaveBeenCalled();
  });

  test('honors SESSION_IDLE_MINUTES from the environment', async () => {
    process.env.SESSION_IDLE_MINUTES = '5';
    setup({ lastActivityAt: new Date(Date.now() - 6 * MIN) });
    const { res, next } = await run();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('a NULL last_activity_at (first request after deploy) is treated as active and gets stamped', async () => {
    const pool = setup({ lastActivityAt: null });
    const { next, res } = await run();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    const updates = updateCalls(pool);
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toMatch(/last_activity_at IS NULL OR last_activity_at < now\(\) - interval '60 seconds'/);
    expect(updates[0][1]).toEqual([7]);
  });

  test('recent-but-stale-by-60s activity proceeds and refreshes the timestamp', async () => {
    const pool = setup({ lastActivityAt: new Date(Date.now() - 10 * MIN) });
    const { next } = await run();
    expect(next).toHaveBeenCalled();
    expect(updateCalls(pool)).toHaveLength(1);
  });

  test('activity within the last 60 seconds skips the write entirely', async () => {
    const pool = setup({ lastActivityAt: new Date(Date.now() - 10 * 1000) });
    const { next } = await run();
    expect(next).toHaveBeenCalled();
    expect(updateCalls(pool)).toHaveLength(0);
  });

  test('a failing activity write never fails the request', async () => {
    setup({ lastActivityAt: null, updateImpl: () => Promise.reject(new Error('db down')) });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { next, res } = await run();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
    expect(res.status).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('a synchronously-throwing activity write never fails the request', async () => {
    setup({ lastActivityAt: null, updateImpl: () => { throw new Error('boom'); } });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { next } = await run();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
    spy.mockRestore();
  });

  test('a token minted after the stale activity (fresh login / support impersonation) counts as activity', async () => {
    setup({ lastActivityAt: new Date(Date.now() - 5 * 3600 * 1000), iat: nowSec() - 60 });
    const { next, res } = await run();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  test('a deactivated practitioner still gets the deactivation message, not the idle one', async () => {
    jwt.verify.mockReturnValue({ practitionerId: 7, role: 'practitioner', slug: 'acme', tenantDb: 'tenant_acme', iat: nowSec() });
    platformPool.query.mockResolvedValue({ rows: [validCompanyRow] });
    getTenantPool.mockReturnValue({ query: jest.fn().mockResolvedValue({ rows: [{ is_active: false, last_activity_at: new Date(0) }] }) });
    const { res } = await run();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('deactivated') }));
  });

  test('an mfaToken (purpose claim) is rejected before any DB lookup', async () => {
    const pool = setup({ lastActivityAt: null, decodedExtra: { purpose: 'mfa' } });
    const { res, next } = await run();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
    expect(platformPool.query).not.toHaveBeenCalled();
  });
});
