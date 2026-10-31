// month.ap used to only report the still-unpaid slice (totalOwed =
// totalClear + totalHeld, scoped to invoiced/completed-not-yet-paid plus
// on_hold/rejected). When a month is almost entirely paid out already,
// that slice is tiny, so a "60% held back" ratio computed against it
// reads as if 60% of the WHOLE month's billing is stuck, when really
// it's 60% of a small leftover remainder. totalPaid (this month's
// already-paid total) lets the frontend show held-back as a fraction of
// the month's total billing instead.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn(),
  formatInvoiceNumber: (id) => `INV-${id}`,
}));

const { pool } = require('../../config/db');
const { deriveEimsStatus } = require('../../utils/invoiceData');
const { getMonthOverview } = require('../dashboardController');

beforeEach(() => {
  pool.query.mockReset();
  deriveEimsStatus.mockReset();
});

describe('getMonthOverview ap.totalPaid', () => {
  test('reports this month\'s already-paid total alongside owed/clear/held', async () => {
    // One unpaid+held session ($40) and one already-paid session ($160) —
    // the month's real total billed is $200, almost all of it paid.
    const heldSession = {
      id: 1, total_time: 60, billing_status: 'on_hold', service_date: '2026-09-15',
      eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 1,
      pay_rate: '40', role: 'practitioner',
    };
    deriveEimsStatus.mockReturnValue({ tier: 'exception', label: 'Held' });

    pool.query.mockImplementation(async (sql) => {
      // Most specific checks first — the paid-count and paid-total queries
      // both match `bb.paid_at IS NOT NULL`, so distinguish by SUM vs COUNT.
      if (/SUM\(ROUND/.test(sql)) return { rows: [{ total: '160.00' }] }; // this month's already-paid total
      if (/COUNT\(\*\)::int AS count[\s\S]*bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 1 }] };
      if (/GROUP BY service_date/.test(sql)) return { rows: [] };
      if (/FROM assessments WHERE service_date/.test(sql) && /COUNT\(\*\)::int AS count FROM assessments WHERE/.test(sql)) return { rows: [{ count: 0 }] };
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/a\.billing_status IN \('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined'\)/.test(sql)) return { rows: [] };
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [] };
      // AP query: held session (unpaid, on_hold) joined with practitioners
      if (/JOIN practitioners p ON p\.id = a\.practitioner_id\s+LEFT JOIN billing_batches/.test(sql)) return { rows: [heldSession] };
      if (/COUNT\(DISTINCT patient_id\)/.test(sql)) return { rows: [{ count: 0 }] };
      return { rows: [] };
    });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getMonthOverview({ query: { month: '2026-09' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const { ap } = res.json.mock.calls[0][0];
    expect(ap).toMatchObject({ totalOwed: 40, totalClear: 0, totalHeld: 40, totalPaid: 160 });
  });
});
