jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantContext', () => ({ runWithTenant: jest.fn((tenantDb, fn) => fn()) }));
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));

process.env.JWT_SECRET = 'test-secret';

const jwt = require('jsonwebtoken');
const { platformPool } = require('../../config/platformDb');
const { runWithTenant } = require('../../config/tenantContext');
const { pool } = require('../../config/db');
const { authHandshake } = require('../handshake');

const session = { practitionerId: 7, email: 'p@x.com', role: 'staff', slug: 'acme', tenantDb: 'tenant_acme', accountType: 'tenant' };
const sign = (payload, expiresIn = '24h') => jwt.sign(payload, 'test-secret', { expiresIn });

const activeCompany = { rows: [{ status: 'active', trial_ends_at: null, baa_accepted_at: new Date().toISOString() }] };

async function connect(token) {
  const socket = { handshake: { auth: { token } } };
  const next = jest.fn();
  await authHandshake(socket, next);
  return { socket, next };
}

beforeEach(() => {
  runWithTenant.mockImplementation((tenantDb, fn) => fn());
});
afterEach(() => jest.resetAllMocks());

describe('authHandshake', () => {
  test('a normal session token connects and freezes identity on socket.data', async () => {
    platformPool.query.mockResolvedValueOnce(activeCompany);
    pool.query.mockResolvedValueOnce({ rows: [{ first_name: 'Pat', last_name: 'Lee', is_active: true }] });
    const { socket, next } = await connect(sign(session));
    expect(next).toHaveBeenCalledWith();
    expect(socket.data).toMatchObject({ staffId: 7, tenantDb: 'tenant_acme', name: 'Pat Lee', isOffice: true });
  });

  test.each(['verify', 'enroll'])('a password-only MFA token (stage %s) is rejected before any DB lookup', async (stage) => {
    platformPool.query.mockResolvedValue(activeCompany);
    pool.query.mockResolvedValue({ rows: [{ first_name: 'Pat', last_name: 'Lee', is_active: true }] });
    const { socket, next } = await connect(sign({ ...session, purpose: 'mfa', stage }, '10m'));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
    expect(socket.data).toBeUndefined();
    expect(platformPool.query).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('any other purpose-scoped token is rejected too (same rule as protect)', async () => {
    platformPool.query.mockResolvedValue(activeCompany);
    pool.query.mockResolvedValue({ rows: [{ first_name: 'Pat', last_name: 'Lee', is_active: true }] });
    const { next, socket } = await connect(sign({ ...session, purpose: 'something_else' }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
    expect(socket.data).toBeUndefined();
  });

  test('an idle-expired session (same rule as protect) is rejected', async () => {
    platformPool.query.mockResolvedValueOnce(activeCompany);
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    pool.query.mockResolvedValueOnce({ rows: [{ first_name: 'Pat', last_name: 'Lee', is_active: true, last_activity_at: longAgo }] });
    const token = sign({ ...session, iat: Math.floor(Date.now() / 1000) - 3 * 60 * 60 });
    const { next, socket } = await connect(token);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
    expect(socket.data).toBeUndefined();
  });

  test('recent activity keeps the session connectable', async () => {
    platformPool.query.mockResolvedValueOnce(activeCompany);
    pool.query.mockResolvedValueOnce({ rows: [{ first_name: 'Pat', last_name: 'Lee', is_active: true, last_activity_at: new Date().toISOString() }] });
    const token = sign({ ...session, iat: Math.floor(Date.now() / 1000) - 3 * 60 * 60 });
    const { next } = await connect(token);
    expect(next).toHaveBeenCalledWith();
  });

  test('a deactivated practitioner is rejected', async () => {
    platformPool.query.mockResolvedValueOnce(activeCompany);
    pool.query.mockResolvedValueOnce({ rows: [{ first_name: 'Pat', last_name: 'Lee', is_active: false }] });
    const { next, socket } = await connect(sign(session));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
    expect(socket.data).toBeUndefined();
  });
});
