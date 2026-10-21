jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));

const crypto = require('crypto');
const { pool } = require('../../config/db');
const td = require('../trustedDevices');

afterEach(() => {
  jest.resetAllMocks();
  delete process.env.TRUSTED_DEVICE_DAYS;
});

describe('deviceLabelFromUserAgent', () => {
  const cases = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari on iPad'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari on Mac'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', 'Edge on Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1', 'Chrome on iPhone'],
  ];
  test.each(cases)('%s -> %s', (ua, label) => {
    expect(td.deviceLabelFromUserAgent(ua)).toBe(label);
  });

  test('falls back to Unknown device and never exceeds 60 chars', () => {
    expect(td.deviceLabelFromUserAgent(undefined)).toBe('Unknown device');
    expect(td.deviceLabelFromUserAgent('')).toBe('Unknown device');
    expect(td.deviceLabelFromUserAgent('curl/8.0')).toBe('Unknown device');
    expect(td.deviceLabelFromUserAgent('x'.repeat(5000)).length).toBeLessThanOrEqual(60);
  });
});

describe('mintTrustedDevice', () => {
  test('stores only the sha256 hash of a 32-byte base64url token, 30-day default expiry, caps at 10', async () => {
    pool.query.mockImplementation((sql) => Promise.resolve(/INSERT INTO mfa_trusted_devices/.test(sql)
      ? { rows: [{ id: 'dev-1', label: 'Chrome on Windows' }] }
      : { rows: [], rowCount: 0 }));
    const before = Date.now();
    const out = await td.mintTrustedDevice(7, 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36');
    expect(out.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(out.token, 'base64url')).toHaveLength(32);
    expect(out.id).toBe('dev-1');
    expect(out.label).toBe('Chrome on Windows');
    const days = (new Date(out.expiresAt).getTime() - before) / 86400000;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThan(30.01);

    const insert = pool.query.mock.calls.find(([sql]) => /INSERT INTO mfa_trusted_devices/.test(sql));
    const expectedHash = crypto.createHash('sha256').update(out.token).digest('hex');
    expect(insert[1]).toContain(expectedHash);
    expect(insert[1]).not.toContain(out.token);
    expect(insert[1][0]).toBe(7);

    const cap = pool.query.mock.calls.find(([sql]) => /OFFSET/.test(sql));
    expect(cap[0]).toMatch(/revoked_at = now\(\)/);
    expect(cap[0]).toMatch(/ORDER BY created_at DESC/);
    expect(cap[1]).toEqual([7, 10]);
  });

  test('honours TRUSTED_DEVICE_DAYS', async () => {
    process.env.TRUSTED_DEVICE_DAYS = '7';
    pool.query.mockResolvedValue({ rows: [{ id: 'd', label: 'x' }] });
    const out = await td.mintTrustedDevice(7, '');
    const days = (new Date(out.expiresAt).getTime() - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(7);
  });
});

describe('consumeTrustedDevice', () => {
  test('looks up by hash scoped to the practitioner, only active rows, and stamps last_used_at', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'dev-1', label: 'L' }] });
    const row = await td.consumeTrustedDevice(7, 'tok');
    expect(row).toEqual({ id: 'dev-1', label: 'L' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/SET last_used_at = now\(\)/);
    expect(sql).toMatch(/practitioner_id = \$1/);
    expect(sql).toMatch(/token_hash = \$2/);
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(sql).toMatch(/expires_at > now\(\)/);
    expect(params).toEqual([7, crypto.createHash('sha256').update('tok').digest('hex')]);
  });

  test('returns null without touching the DB for a missing/garbage token', async () => {
    for (const t of [undefined, null, '', 123, {}, 'x'.repeat(300)]) {
      expect(await td.consumeTrustedDevice(7, t)).toBeNull();
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('returns null when no row matches', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect(await td.consumeTrustedDevice(7, 'tok')).toBeNull();
  });
});

describe('revokeAllTrustedDevices', () => {
  test('revokes every active device for the practitioner', async () => {
    pool.query.mockResolvedValue({ rowCount: 3 });
    expect(await td.revokeAllTrustedDevices(7)).toBe(3);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE mfa_trusted_devices SET revoked_at = now\(\)/);
    expect(sql).toMatch(/practitioner_id = \$1 AND revoked_at IS NULL/);
    expect(params).toEqual([7]);
  });

  test('tolerates a driver returning nothing', async () => {
    pool.query.mockResolvedValue(undefined);
    expect(await td.revokeAllTrustedDevices(7)).toBe(0);
  });

  const missingTable = () => Object.assign(new Error('relation "mfa_trusted_devices" does not exist'), { code: '42P01' });

  test('by default a missing table (42P01) still throws', async () => {
    pool.query.mockRejectedValue(missingTable());
    await expect(td.revokeAllTrustedDevices(7)).rejects.toMatchObject({ code: '42P01' });
  });

  test('with tolerateMissingTable, a missing table means no devices to revoke (0)', async () => {
    pool.query.mockRejectedValue(missingTable());
    expect(await td.revokeAllTrustedDevices(7, { tolerateMissingTable: true })).toBe(0);
  });

  test('with tolerateMissingTable, any other error still throws', async () => {
    pool.query.mockRejectedValue(Object.assign(new Error('connection reset'), { code: '08006' }));
    await expect(td.revokeAllTrustedDevices(7, { tolerateMissingTable: true })).rejects.toThrow('connection reset');
    pool.query.mockRejectedValue(new Error('no code'));
    await expect(td.revokeAllTrustedDevices(7, { tolerateMissingTable: true })).rejects.toThrow('no code');
  });
});
