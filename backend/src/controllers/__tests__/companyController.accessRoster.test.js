jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/storage', () => ({}));
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { getAccessRoster, updateCompanySettings } = require('../companyController');

const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
afterEach(() => jest.resetAllMocks());

describe('getAccessRoster', () => {
  it('returns the official and active staff with only safe fields, and audits the view', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ confidentiality_official_name: 'Pat', confidentiality_official_title: 'Director', confidentiality_official_email: 'pat@x.com', confidentiality_official_phone: '555' }] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'A', last_name: 'B', position_title: 'SLP', role_name: 'Therapist', created_at: '2026-01-01' }] });
    const res = mkRes();
    await getAccessRoster({ practitioner: { practitionerId: 1 } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.official).toEqual({ name: 'Pat', title: 'Director', email: 'pat@x.com', phone: '555' });
    expect(body.staff).toEqual([{ first_name: 'A', last_name: 'B', position_title: 'SLP', role_name: 'Therapist', date_added: '2026-01-01' }]);
    const staffSql = pool.query.mock.calls[1][0];
    expect(staffSql).toMatch(/is_active = true/);
    expect(staffSql).not.toMatch(/ssn|pay_rate|p\.email/);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_roster_view' }));
  });
  it('official is null when none is set', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{}] }).mockResolvedValueOnce({ rows: [] });
    const res = mkRes();
    await getAccessRoster({ practitioner: { practitionerId: 1 } }, res);
    expect(res.json.mock.calls[0][0].official).toBeNull();
  });
});

describe('updateCompanySettings', () => {
  it('persists the four confidentiality official fields', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{}] });
    const res = mkRes();
    await updateCompanySettings({ body: { display_name: 'D', confidentiality_official_name: 'Pat', confidentiality_official_title: 'T', confidentiality_official_email: 'e@x.com', confidentiality_official_phone: '1' } }, res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/confidentiality_official_name/);
    expect(params).toEqual(expect.arrayContaining(['Pat', 'T', 'e@x.com', '1']));
  });
});
