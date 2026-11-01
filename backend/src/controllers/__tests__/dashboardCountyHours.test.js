// GET /api/dashboard/county-hours?month=YYYY-MM — the Overview's "Hours by
// County" card. Unlike bucketBreakdown (used by Services provided), this is
// sorted by HOURS, not session count, and has no unit toggle — the card
// exists specifically to show hours, so count sorting would put a county
// with many short sessions ahead of one with fewer, longer sessions.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../../config/db');
const { getCountyHours } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('getCountyHours', () => {
  test('returns counties sorted by hours descending', async () => {
    const req = { query: { month: '2026-09' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({
      rows: [
        { patient_county: 'Ocean', hours: '320' },
        { patient_county: 'Monmouth', hours: '540' },
        { patient_county: 'Essex', hours: '210' },
      ],
    });

    await getCountyHours(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.counties).toEqual([
      { county: 'Monmouth', hours: 540 },
      { county: 'Ocean', hours: 320 },
      { county: 'Essex', hours: 210 },
    ]);
  });

  test('buckets a null/blank county as "Other" rather than dropping it', async () => {
    const req = { query: { month: '2026-09' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({
      rows: [
        { patient_county: 'Bergen', hours: '100' },
        { patient_county: null, hours: '40' },
      ],
    });

    await getCountyHours(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.counties).toEqual([
      { county: 'Bergen', hours: 100 },
      { county: 'Other', hours: 40 },
    ]);
  });

  test('collapses beyond the top 6 counties into "Other", merging with any existing null bucket', async () => {
    const req = { query: { month: '2026-09' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => ({ patient_county: `County${i}`, hours: String(100 - i * 10) })),
      { patient_county: null, hours: '5' },
    ];
    pool.query.mockResolvedValueOnce({ rows });

    await getCountyHours(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.counties).toHaveLength(7); // top 6 + Other
    // top6 hours: 100,90,80,70,60,50; overflow: County6(40)+County7(30)+null(5)=75
    expect(payload.counties[6]).toEqual({ county: 'Other', hours: 75 });
  });

  test('scopes the query to the given month', async () => {
    const req = { query: { month: '2026-09' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getCountyHours(req, res);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/service_date >= \$1 AND service_date <= \$2/);
    expect(params[0]).toBe('2026-09-01');
    expect(params[1]).toBe('2026-09-30');
  });
});
