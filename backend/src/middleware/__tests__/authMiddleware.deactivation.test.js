jest.mock('jsonwebtoken', () => ({ verify: jest.fn(), sign: jest.fn() }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantPoolRegistry', () => ({ getTenantPool: jest.fn() }));
jest.mock('../../config/tenantContext', () => ({ runWithTenant: jest.fn((tenantDb, fn) => fn()) }));
jest.mock('../../constants/dropdownOptionsCache', () => ({ ensureDropdownOptionsCacheLoaded: jest.fn().mockResolvedValue() }));

const jwt = require('jsonwebtoken');
const { platformPool } = require('../../config/platformDb');
const { getTenantPool } = require('../../config/tenantPoolRegistry');
const { protect } = require('../authMiddleware');

// FERPA/IDEA Part C §303.404 — access revocation must be immediate, not
// wait for a 24h JWT to expire. protect now re-checks the practitioner's
// own is_active flag (tenant DB) on every request, alongside the existing
// company status/trial/BAA checks (platform DB).
describe('protect: practitioner is_active revocation', () => {
  afterEach(() => jest.clearAllMocks());

  const baseDecoded = { practitionerId: 7, role: 'practitioner', slug: 'acme', tenantDb: 'tenant_acme' };
  const validCompanyRow = { status: 'active', trial_ends_at: null, baa_accepted_at: new Date() };

  function setup({ decoded = baseDecoded, companyRows = [validCompanyRow], practitionerRows }) {
    jwt.verify.mockReturnValue(decoded);
    platformPool.query.mockResolvedValue({ rows: companyRows });
    const tenantPool = { query: jest.fn().mockResolvedValue({ rows: practitionerRows }) };
    getTenantPool.mockReturnValue(tenantPool);
    return tenantPool;
  }

  test('a deactivated practitioner (is_active=false) gets 401, even with a valid unexpired JWT', async () => {
    setup({ practitionerRows: [{ is_active: false }] });
    const req = { headers: { authorization: 'Bearer faketoken' }, originalUrl: '/api/patients' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await new Promise((resolve) => {
      protect(req, res, next);
      setImmediate(resolve);
    });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('deactivated') }));
    expect(next).not.toHaveBeenCalled();
  });

  test('a missing practitioner row (deleted, or a stale JWT) fails closed with 401, not treated as active', async () => {
    setup({ practitionerRows: [] });
    const req = { headers: { authorization: 'Bearer faketoken' }, originalUrl: '/api/patients' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await new Promise((resolve) => {
      protect(req, res, next);
      setImmediate(resolve);
    });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('an active practitioner proceeds to next() as before', async () => {
    setup({ practitionerRows: [{ is_active: true }] });
    const req = { headers: { authorization: 'Bearer faketoken' }, originalUrl: '/api/patients' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await new Promise((resolve) => {
      protect(req, res, next);
      setImmediate(resolve);
    });

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  test('the is_active lookup is scoped to the correct tenant DB and practitioner id', async () => {
    const tenantPool = setup({ practitionerRows: [{ is_active: true }] });
    const req = { headers: { authorization: 'Bearer faketoken' }, originalUrl: '/api/patients' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await new Promise((resolve) => {
      protect(req, res, next);
      setImmediate(resolve);
    });

    expect(getTenantPool).toHaveBeenCalledWith('tenant_acme');
    expect(tenantPool.query).toHaveBeenCalledWith(expect.stringContaining('is_active'), [7]);
  });
});
