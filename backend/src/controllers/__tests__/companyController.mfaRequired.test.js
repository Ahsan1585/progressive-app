jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/storage', () => ({}));

const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { updateMfaRequirement } = require('../companyController');

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

describe('updateMfaRequirement', () => {
  afterEach(() => jest.resetAllMocks());

  test('rejects a non-boolean value without touching the DB', async () => {
    const res = makeRes();
    await updateMfaRequirement({ body: { mfaRequired: 'yes' }, practitioner: { practitionerId: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('upserts only mfa_required and audits the change', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ mfa_required: true }] });
    const res = makeRes();
    const req = { body: { mfaRequired: true }, practitioner: { practitionerId: 1 } };
    await updateMfaRequirement(req, res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO company_settings \(id, mfa_required, updated_at\)/);
    expect(sql).toMatch(/DO UPDATE SET mfa_required = EXCLUDED.mfa_required/);
    expect(params).toEqual([true]);
    expect(res.json).toHaveBeenCalledWith({ success: true, mfaRequired: true });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ req, action: 'mfa_requirement_changed', details: { mfaRequired: true } }));
  });
});
