// getServicesBreakdown: ?practitionerId= scopes all four GROUP BY queries,
// and bucketBreakdown carries an hours field through (including into the
// synthesized "Other" bucket when there are more than 6 categories).
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../constants/njeis', () => ({
  serviceCodeLabel: (code) => code,
  locationCodeLabel: (code) => code,
}));

const { pool } = require('../../config/db');
const { getServicesBreakdown } = require('../dashboardController');

beforeEach(() => pool.query.mockReset());

describe('getServicesBreakdown practitioner filter + hours', () => {
  test('all four breakdown queries bind practitionerId', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getServicesBreakdown({ query: { month: '2026-10', practitionerId: '6' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const typeCall = pool.query.mock.calls.find(([sql]) => /GROUP BY type/.test(sql));
    expect(typeCall[0]).toMatch(/practitioner_id = \$3/);
    expect(typeCall[1]).toContain(6);

    const statusCall = pool.query.mock.calls.find(([sql]) => /GROUP BY billing_status/.test(sql));
    expect(statusCall[0]).toMatch(/practitioner_id = \$3/);
    expect(statusCall[1]).toContain(6);

    const locationCall = pool.query.mock.calls.find(([sql]) => /GROUP BY location/.test(sql));
    expect(locationCall[0]).toMatch(/practitioner_id = \$3/);
    expect(locationCall[1]).toContain(6);

    const disciplineCall = pool.query.mock.calls.find(([sql]) => /GROUP BY p\.position_title/.test(sql));
    expect(disciplineCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(disciplineCall[1]).toContain(6);
  });

  test('each bucket reports hours alongside count', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY type/.test(sql)) return { rows: [{ type: 'OT', count: 3, hours: '4.5' }] };
      return { rows: [] };
    });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getServicesBreakdown({ query: { month: '2026-10' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.byServiceType[0]).toMatchObject({ count: 3, hours: 4.5 });
  });

  test('the synthesized "Other" bucket sums hours too, not just count', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ type: `T${i}`, count: 1, hours: '1' }));
    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY type/.test(sql)) return { rows };
      return { rows: [] };
    });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getServicesBreakdown({ query: { month: '2026-10' } }, res);

    const body = res.json.mock.calls[0][0];
    const other = body.byServiceType.find((b) => b.key === 'other');
    expect(other).toBeDefined();
    expect(other.hours).toBe(2); // 2 overflow rows beyond the top 6, 1 hour each
  });
});
