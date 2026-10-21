jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { logAudit } = require('../auditLog');

describe('logAudit durability', () => {
  let errSpy;
  beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { jest.resetAllMocks(); errSpy.mockRestore(); });

  const args = { actorId: 1, actorEmail: 'a@b.c', actorRole: 'admin', action: 'x_view', resourceType: 'patient', resourceId: 5, details: { count: 2 } };

  test('success inserts exactly once, no error log', async () => {
    pool.query.mockResolvedValue({});
    await logAudit(args);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
  });

  test('transient failure is retried once and succeeds without error log', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({});
    await logAudit(args);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(errSpy).not.toHaveBeenCalled();
  });

  test('double failure logs one structured line with full payload and does not throw', async () => {
    pool.query.mockRejectedValue(new Error('down'));
    await expect(logAudit(args)).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledTimes(1);
    const line = errSpy.mock.calls[0].join(' ');
    expect(line).toContain('AUDIT_LOG_INSERT_FAILED');
    const json = JSON.parse(line.slice(line.indexOf('{')));
    expect(json).toMatchObject({ actorId: 1, actorEmail: 'a@b.c', actorRole: 'admin', action: 'x_view', resourceType: 'patient', resourceId: '5', details: { count: 2 } });
    expect(json.timestamp).toBeTruthy();
  });
});
