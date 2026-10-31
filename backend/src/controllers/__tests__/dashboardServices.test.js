jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../constants/njeis', () => ({
  serviceCodeLabel: (code) => (code === 'DI' ? 'Developmental Intervention' : code === 'OT' ? 'Occupational Therapy' : code),
  locationCodeLabel: (code) => (code === 'HOME' ? 'Home' : code),
}));

const { pool } = require('../../config/db');
const { getServicesBreakdown } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('getServicesBreakdown', () => {
  test('returns all four dimensions with resolved labels, sorted by count desc', async () => {
    const req = { query: { month: '2026-10' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'OT', count: '5' }, { type: 'DI', count: '12' }] }) // service type
      .mockResolvedValueOnce({ rows: [{ billing_status: 'invoiced', count: '10' }] }) // status
      .mockResolvedValueOnce({ rows: [{ location: 'HOME', count: '17' }] }) // location
      .mockResolvedValueOnce({ rows: [{ position_title: 'OT', count: '17' }] }); // discipline

    await getServicesBreakdown(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.byServiceType).toEqual([
      { key: 'DI', label: 'Developmental Intervention', count: 12, hours: 0 },
      { key: 'OT', label: 'Occupational Therapy', count: 5, hours: 0 },
    ]);
    expect(payload.byLocation).toEqual([{ key: 'HOME', label: 'Home', count: 17, hours: 0 }]);
    expect(payload.byDiscipline).toEqual([{ key: 'OT', label: 'OT', count: 17, hours: 0 }]);
  });

  test('buckets a null dimension value as "Not specified" rather than dropping it', async () => {
    const req = { query: { month: '2026-10' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: null, count: '3' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await getServicesBreakdown(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.byServiceType).toEqual([{ key: null, label: 'Not specified', count: 3, hours: 0 }]);
  });

  test('collapses beyond the top 6 into an "Other" bucket', async () => {
    const req = { query: { month: '2026-10' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const rows = Array.from({ length: 8 }, (_, i) => ({ type: `T${i}`, count: String(10 - i) }));
    pool.query
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await getServicesBreakdown(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.byServiceType).toHaveLength(7); // top 6 + Other
    // counts are 10,9,8,7,6,5,4,3 -> top6 sum indices 0-5 (10..5), remainder T6(4)+T7(3)=7
    expect(payload.byServiceType[6]).toEqual({ key: 'other', label: 'Other', count: 7, hours: 0 });
  });
});
