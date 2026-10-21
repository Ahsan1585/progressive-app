jest.mock('../../middleware/authMiddleware', () => {
  const mk = (name) => Object.defineProperty(jest.fn(), 'name', { value: name });
  return {
    protect: mk('protect'),
    protectSessionOrMfaToken: mk('protectSessionOrMfaToken'),
    requireMfaChallenge: jest.fn((stage) => mk(`requireMfaChallenge_${stage}`)),
    requireRole: jest.fn(() => mk('requireRole')),
    loadPermissions: mk('loadPermissions'),
    requirePermission: jest.fn(() => mk('requirePermission')),
    requireAnyPermission: jest.fn(() => mk('requireAnyPermission')),
    requireStaffEditOrSelf: mk('requireStaffEditOrSelf'),
    requirePlatformSupportOnly: mk('requirePlatformSupportOnly'),
  };
});
jest.mock('../../middleware/tenantMiddleware', () => ({ resolveTenantBySlug: jest.fn() }));
// Every controller export becomes a jest.fn named after itself, so the
// route chain can be asserted by handler name.
const mockNamedFnProxy = () => new Proxy({}, {
  get: (target, prop) => {
    if (!target[prop]) target[prop] = Object.defineProperty(jest.fn(), 'name', { value: String(prop) });
    return target[prop];
  },
});
jest.mock('../../controllers/practitionerImportController', () => mockNamedFnProxy());
jest.mock('../../controllers/authController', () => mockNamedFnProxy());

const router = require('../authRoutes');

function route(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer ? layer.route.stack.map((s) => s.handle.name || '<anon>') : null;
}

describe('authRoutes MFA wiring', () => {
  test('POST /mfa/verify: rate-limited, verify-stage mfaToken only', () => {
    const chain = route('post', '/mfa/verify');
    expect(chain).not.toBeNull();
    expect(chain).toEqual([expect.any(String), 'requireMfaChallenge_verify', 'verifyMfa']);
    expect(chain[0]).not.toBe('protect');
  });

  test('POST /mfa/setup: rate-limited (it now checks the password), session or enroll mfaToken', () => {
    const chain = route('post', '/mfa/setup');
    expect(chain).toHaveLength(3);
    expect(chain.slice(1)).toEqual(['protectSessionOrMfaToken', 'setupMfa']);
  });

  test('POST /staff/:id/mfa-reset: real session, ceo only', () => {
    const { requireRole } = require('../../middleware/authMiddleware');
    expect(route('post', '/staff/:id/mfa-reset')).toEqual(['protect', 'requireRole', 'resetStaffMfa']);
    expect(requireRole).toHaveBeenCalledWith(['ceo']);
    const ceoOnlyCalls = requireRole.mock.calls.filter(([roles]) => roles.length === 1 && roles[0] === 'ceo');
    expect(ceoOnlyCalls.length).toBeGreaterThanOrEqual(2); // accept-baa + mfa-reset
  });

  test('POST /mfa/enable: rate-limited, session or enroll mfaToken', () => {
    const chain = route('post', '/mfa/enable');
    expect(chain).toHaveLength(3);
    expect(chain.slice(1)).toEqual(['protectSessionOrMfaToken', 'enableMfa']);
  });

  test('POST /mfa/disable: real session only, rate-limited', () => {
    const chain = route('post', '/mfa/disable');
    expect(chain).toHaveLength(3);
    expect(chain.slice(1)).toEqual(['protect', 'disableMfa']);
  });
});
