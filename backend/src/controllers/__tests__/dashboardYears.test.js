// GET /api/dashboard/years: session totals for every year that has data, for the
// Overview's "Year" view (all years side by side).
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn(),
  deriveEimsStatus: jest.fn(),
  formatInvoiceNumber: (id) => `INV-${id}`,
}));

const { pool } = require('../../config/db');
const { getYearsOverview } = require('../dashboardController');

beforeEach(() => pool.query.mockReset());

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

function prime({ years = [], roster = 3 } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (/EXTRACT\(YEAR FROM/i.test(sql)) return { rows: years };
    if (/FROM practitioners/.test(sql)) return { rows: [{ active_now: roster }] };
    throw new Error(`unexpected query: ${sql}`);
  });
}

test('returns one row per year, oldest first, with rounded billable amounts and overall totals', async () => {
  prime({ years: [
    { year: 2025, count: 40, est_billable: '1999.999' },
    { year: 2026, count: 12, est_billable: '600.5' },
  ] });
  const res = mkRes();
  await getYearsOverview({ query: {} }, res);
  const out = res.json.mock.calls[0][0];
  expect(out.success).toBe(true);
  expect(out.years).toEqual([
    { year: 2025, count: 40, estBillable: 2000 },
    { year: 2026, count: 12, estBillable: 600.5 },
  ]);
  expect(out.totalSessions).toBe(52);
  expect(out.totalEstBillable).toBe(2600.5);
  expect(out.practitionerRoster.activeNow).toBe(3);
});

test('is not scoped to any month or year', async () => {
  prime({ years: [] });
  await getYearsOverview({ query: { month: '2026-10', year: '2026' } }, mkRes());
  const sql = pool.query.mock.calls.map(([s]) => s).find((s) => /EXTRACT\(YEAR FROM/i.test(s));
  expect(sql).not.toMatch(/\$1/);
  expect(pool.query.mock.calls[0][1]).toBeUndefined();
});

test('no data at all: empty list and zero totals, not an error', async () => {
  prime({ years: [] });
  const res = mkRes();
  await getYearsOverview({}, res);
  const out = res.json.mock.calls[0][0];
  expect(out.years).toEqual([]);
  expect(out.totalSessions).toBe(0);
  expect(out.totalEstBillable).toBe(0);
});

test('500 on a database error', async () => {
  pool.query.mockRejectedValue(new Error('db'));
  const res = mkRes();
  await getYearsOverview({}, res);
  expect(res.status).toHaveBeenCalledWith(500);
});
