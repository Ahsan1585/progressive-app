// GET /api/practitioner-dashboard/agency-summary: an agency practitioner's own
// notes only, priced at their own pay rate, for the month they pick.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { getAgencySummary } = require('../practitionerDashboardController');

const mkRes = () => {
  const res = { statusCode: 200 };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
};
const req = (query = {}) => ({ practitioner: { practitionerId: 42, role: 'practitioner' }, query });

beforeEach(() => pool.query.mockReset());

test('reads only the signed-in practitioner\'s notes, with paid status from the billing batch', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ pay_rate: '60' }] })
    .mockResolvedValueOnce({ rows: [
      { id: 1, service_date: '2026-10-05', total_time: 60, billing_status: 'invoiced', billing_review: 'accept', eims_missing_status: null, paid_at: new Date('2026-10-20T00:00:00Z'), patient_first_name: 'Leo', patient_last_name: 'Rivera' },
    ] });
  const res = mkRes();
  await getAgencySummary(req({ month: '2026-10' }), res);
  const [sql, params] = pool.query.mock.calls[1];
  expect(sql).toMatch(/practitioner_id = \$1/);
  expect(sql).toMatch(/LEFT JOIN billing_batches/);
  expect(sql).toMatch(/billing_status != 'voided'/);
  expect(params).toEqual([42]);
  expect(res.body.success).toBe(true);
  expect(res.body.month).toBe('2026-10');
  expect(res.body.tiles.paid).toEqual({ count: 1, value: 60 });
});

test('a malformed month falls back to the current month instead of erroring', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ pay_rate: null }] }).mockResolvedValueOnce({ rows: [] });
  const res = mkRes();
  await getAgencySummary(req({ month: "2026-13' OR 1=1" }), res);
  expect(res.statusCode).toBe(200);
  expect(res.body.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  expect(res.body.hasPayRate).toBe(false);
});

test('a database error is a 500 with a plain message', async () => {
  pool.query.mockRejectedValueOnce(new Error('db down'));
  const res = mkRes();
  await getAgencySummary(req(), res);
  expect(res.statusCode).toBe(500);
  expect(res.body.error).toMatch(/Failed/);
});
