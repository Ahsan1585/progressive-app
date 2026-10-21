jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantPoolRegistry', () => ({ getTenantPool: jest.fn() }));
const { protect, loadPermissions } = require('../../middleware/authMiddleware');
const { requireConsentAccess } = require('../../middleware/consentAccess');

const routesOf = (router) => router.stack
  .filter((l) => l.route)
  .flatMap((l) => Object.keys(l.route.methods).map((m) => ({
    method: m.toUpperCase(), path: l.route.path, handles: l.route.stack.map((s) => s.handle),
  })));
const find = (routes, method, path) => routes.find((r) => r.method === method && r.path === path);

describe('patientRoutes consent endpoints', () => {
  const routes = routesOf(require('../patientRoutes'));
  test.each([
    ['GET', '/:id/consents'],
    ['POST', '/:id/consents'],
    ['DELETE', '/:id/consents/:consentId'],
    ['GET', '/:id/consent-requests'],
    ['POST', '/:id/consent-requests'],
    ['POST', '/:id/consent-requests/:requestId/resend'],
    ['DELETE', '/:id/consent-requests/:requestId'],
  ])('%s %s runs protect -> loadPermissions -> requireConsentAccess (no role gate)', (method, path) => {
    const r = find(routes, method, path);
    expect(r).toBeDefined();
    const i = r.handles.indexOf(protect);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(r.handles.indexOf(loadPermissions)).toBe(i + 1);
    expect(r.handles.indexOf(requireConsentAccess)).toBe(i + 2);
    expect(r.handles.length).toBe(i + 4);
  });
});

describe('consentRequestRoutes', () => {
  test('GET /pending is protected and permission-gated', async () => {
    const routes = routesOf(require('../consentRequestRoutes'));
    const r = find(routes, 'GET', '/pending');
    expect(r).toBeDefined();
    expect(r.handles[0]).toBe(protect);
    expect(r.handles[1]).toBe(loadPermissions);
    // The permission gate: admin or patient_record_rights passes, others 403.
    const gate = r.handles[2];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    gate({ isAdmin: false, permissions: new Set() }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    gate({ isAdmin: false, permissions: new Set(['patient_record_rights']) }, res, next);
    gate({ isAdmin: true, permissions: new Set() }, res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('consentSigningRoutes (public)', () => {
  test('three public routes, each rate-limited and tenant-resolved from the slug, none using protect', () => {
    const { resolveTenantBySlug } = require('../../middleware/tenantMiddleware');
    const routes = routesOf(require('../consentSigningRoutes'));
    for (const [method, path] of [['GET', '/:companySlug/:token'], ['POST', '/:companySlug/:token/verify'], ['POST', '/:companySlug/:token/sign']]) {
      const r = find(routes, method, path);
      expect(r).toBeDefined();
      expect(r.handles).not.toContain(protect);
      expect(r.handles[1]).toBe(resolveTenantBySlug);
      expect(r.handles.length).toBe(3);
    }
  });
});
