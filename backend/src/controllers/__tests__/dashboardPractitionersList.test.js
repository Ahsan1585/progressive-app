// GET /api/dashboard/practitioners — the Overview control bar's practitioner
// filter dropdown. Same dashboardGuard access level as the rest of Overview
// (not gated behind staff_directory_view/practitioner_manage), and excludes
// independent_practitioner the same way the accuracy table already does
// (self-reported, not EIMS-cross-checked).
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../../config/db');
const { getDashboardPractitioners } = require('../dashboardController');

beforeEach(() => pool.query.mockReset());

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

describe('getDashboardPractitioners', () => {
  test('returns {id, name} pairs, excluding independent practitioners', async () => {
    pool.query.mockResolvedValue({
      rows: [
        { id: 1, first_name: 'Omar', last_name: 'Abernathy' },
        { id: 2, first_name: 'Jenna', last_name: 'Abernathy' },
      ],
    });
    const res = mkRes();
    await getDashboardPractitioners({ query: {} }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      practitioners: [
        { id: 1, name: 'Omar Abernathy' },
        { id: 2, name: 'Jenna Abernathy' },
      ],
    });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/role != 'independent_practitioner'/);
  });

  test('an empty company returns an empty list, not an error', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = mkRes();
    await getDashboardPractitioners({ query: {} }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, practitioners: [] });
  });

  test('a query failure reports a 500, not an unhandled rejection', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    const res = mkRes();
    await getDashboardPractitioners({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
