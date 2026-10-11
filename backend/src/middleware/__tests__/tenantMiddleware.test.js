jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantContext', () => ({
  runWithTenant: jest.fn((db, fn) => fn()),
}));
const { platformPool } = require('../../config/platformDb');
const { resolveTenantBySlug } = require('../tenantMiddleware');

function mockReqRes(body) {
  const req = { body };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

// resolveTenantBySlug is NOT async — it kicks off a .then()-chained promise
// and returns undefined immediately, so `await resolveTenantBySlug(...)`
// does not actually wait for res.json()/next() to run. A microtask-only
// flush (chained Promise.resolve() ticks) was not enough to let the mocked
// platformPool.query's own promise fully settle; a real macrotask tick
// (setTimeout) does.
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('resolveTenantBySlug', () => {
  // resetAllMocks (not clearAllMocks) — clearAllMocks only wipes
  // mock.calls/instances/results, it leaves queued mockResolvedValueOnce
  // implementations in place, so an earlier test's unconsumed 2nd queued
  // value (today's unimplemented pending_signups lookup) would silently
  // become THIS test's 1st resolved value otherwise.
  afterEach(() => jest.resetAllMocks());

  it('tells an unconfirmed independent-practitioner signer to confirm their email first', async () => {
    platformPool.query
      .mockResolvedValueOnce({ rows: [] }) // lookupCompanyBySlug: not in companies yet
      .mockResolvedValueOnce({ rows: [{ account_type: 'independent' }] }); // pending_signups lookup

    const { req, res, next } = mockReqRes({ slug: 'jsmith' });
    resolveTenantBySlug(req, res, next);
    await flushMicrotasks();

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Please confirm your email before logging in — check your inbox for the confirmation link we sent when you signed up.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps the generic "unknown company code" error for a slug with no pending signup at all', async () => {
    platformPool.query
      .mockResolvedValueOnce({ rows: [] }) // lookupCompanyBySlug: not in companies
      .mockResolvedValueOnce({ rows: [] }); // pending_signups: nothing either

    const { req, res, next } = mockReqRes({ slug: 'nonexistent' });
    resolveTenantBySlug(req, res, next);
    await flushMicrotasks();

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unknown company code' });
  });

  it('keeps the generic "unknown company code" error for an unconfirmed TENANT-company signup (not independent)', async () => {
    platformPool.query
      .mockResolvedValueOnce({ rows: [] }) // lookupCompanyBySlug: not in companies
      .mockResolvedValueOnce({ rows: [{ account_type: 'tenant' }] }); // pending_signups: a tenant-company signup

    const { req, res, next } = mockReqRes({ slug: 'acme' });
    resolveTenantBySlug(req, res, next);
    await flushMicrotasks();

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unknown company code' });
  });
});
