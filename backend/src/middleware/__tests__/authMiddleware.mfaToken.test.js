jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantPoolRegistry', () => ({ getTenantPool: jest.fn() }));
jest.mock('../../config/tenantContext', () => ({ runWithTenant: jest.fn((tenantDb, fn) => fn()) }));
jest.mock('../../constants/dropdownOptionsCache', () => ({ ensureDropdownOptionsCacheLoaded: jest.fn().mockResolvedValue() }));

process.env.JWT_SECRET = 'test-secret';

const jwt = require('jsonwebtoken');
const { platformPool } = require('../../config/platformDb');
const { getTenantPool } = require('../../config/tenantPoolRegistry');
const { runWithTenant } = require('../../config/tenantContext');
const { requireMfaChallenge, protectSessionOrMfaToken } = require('../authMiddleware');

const claims = (stage) => ({ purpose: 'mfa', stage, practitionerId: 7, email: 'p@x.com', role: 'practitioner', slug: 'acme', tenantDb: 'tenant_acme', accountType: 'tenant' });
const sign = (payload, opts = { expiresIn: '10m' }) => jwt.sign(payload, 'test-secret', opts);

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

async function run(mw, req) {
  const res = makeRes();
  const next = jest.fn();
  await new Promise((resolve) => {
    mw(req, res, next);
    setImmediate(resolve);
  });
  return { res, next };
}

afterEach(() => jest.clearAllMocks());

describe('requireMfaChallenge', () => {
  test('accepts a matching-stage mfaToken from the body and runs inside the tenant', async () => {
    const req = { headers: {}, body: { mfaToken: sign(claims('verify')) } };
    const { next, res } = await run(requireMfaChallenge('verify'), req);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.mfaChallenge).toMatchObject({ practitionerId: 7, stage: 'verify' });
    expect(runWithTenant).toHaveBeenCalledWith('tenant_acme', expect.any(Function));
  });

  test('rejects the wrong stage', async () => {
    const { next, res } = await run(requireMfaChallenge('verify'), { headers: {}, body: { mfaToken: sign(claims('enroll')) } });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a real session token (no purpose claim)', async () => {
    const { res, next } = await run(requireMfaChallenge('verify'), { headers: {}, body: { mfaToken: sign({ practitionerId: 7, tenantDb: 'tenant_acme' }, { expiresIn: '24h' }) } });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an expired or missing token', async () => {
    const expired = sign({ ...claims('verify'), exp: Math.floor(Date.now() / 1000) - 10 }, {});
    let r = await run(requireMfaChallenge('verify'), { headers: {}, body: { mfaToken: expired } });
    expect(r.res.status).toHaveBeenCalledWith(401);
    r = await run(requireMfaChallenge('verify'), { headers: {}, body: {} });
    expect(r.res.status).toHaveBeenCalledWith(401);
  });
});

describe('protectSessionOrMfaToken', () => {
  test('an enroll-stage mfaToken in the Authorization header is accepted', async () => {
    const req = { headers: { authorization: `Bearer ${sign(claims('enroll'))}` }, body: {} };
    const { next } = await run(protectSessionOrMfaToken, req);
    expect(next).toHaveBeenCalled();
    expect(req.mfaChallenge).toMatchObject({ stage: 'enroll' });
    expect(req.practitioner).toMatchObject({ practitionerId: 7 });
  });

  test('a verify-stage mfaToken is refused (password-only attacker cannot re-enroll)', async () => {
    const { res, next } = await run(protectSessionOrMfaToken, { headers: { authorization: `Bearer ${sign(claims('verify'))}` }, body: {} });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('a real session token goes through the full protect checks', async () => {
    platformPool.query.mockResolvedValue({ rows: [{ status: 'active', trial_ends_at: null, baa_accepted_at: new Date() }] });
    const tenantPool = { query: jest.fn().mockResolvedValue({ rows: [{ is_active: true, last_activity_at: null }] }) };
    getTenantPool.mockReturnValue(tenantPool);
    const req = { headers: { authorization: `Bearer ${sign({ practitionerId: 7, role: 'practitioner', slug: 'acme', tenantDb: 'tenant_acme' }, { expiresIn: '24h' })}` }, originalUrl: '/api/auth/mfa/setup', body: {} };
    const { next } = await run(protectSessionOrMfaToken, req);
    expect(next).toHaveBeenCalled();
    expect(req.mfaChallenge).toBeUndefined();
    expect(tenantPool.query).toHaveBeenCalledWith(expect.stringContaining('is_active'), [7]);
  });

  test('no token at all is 401', async () => {
    const { res } = await run(protectSessionOrMfaToken, { headers: {}, body: {} });
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
