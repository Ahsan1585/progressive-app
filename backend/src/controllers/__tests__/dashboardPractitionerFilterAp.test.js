// getMonthOverview's ap block, scoped to one practitioner via
// ?practitionerId=, and its companion hours fields
// (totalOwedHours/totalClearHours/totalHeldHours/totalPaidHours).
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

describe('getMonthOverview practitioner filter + ap hours', () => {
  test('?practitionerId= is bound as a param on the AP query and the paid-total query', async () => {
    const heldSession = {
      id: 1, total_time: 90, billing_status: 'on_hold', service_date: '2026-09-15',
      eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 5,
      pay_rate: '40', role: 'practitioner',
    };
    deriveEimsStatus.mockReturnValue({ tier: 'exception', label: 'Held' });

    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY service_date/.test(sql)) return { rows: [] };
      if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(total_time\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/SUM\(ROUND/.test(sql)) return { rows: [{ total: '0', hours: '0' }] };
      if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(a\.total_time\)[\s\S]*bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/a\.billing_status IN \('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined'\)/.test(sql)) return { rows: [] };
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [] };
      if (/JOIN practitioners p ON p\.id = a\.practitioner_id\s+LEFT JOIN billing_batches/.test(sql)) return { rows: [heldSession] };
      if (/COUNT\(DISTINCT patient_id\)/.test(sql)) return { rows: [{ count: 0 }] };
      return { rows: [] };
    });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getMonthOverview({ query: { month: '2026-09', practitionerId: '5' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);

    const apCall = pool.query.mock.calls.find(([sql]) =>
      /JOIN practitioners p ON p\.id = a\.practitioner_id\s+LEFT JOIN billing_batches/.test(sql)
    );
    expect(apCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(apCall[1]).toEqual(['2026-09-01', '2026-09-30', 5]);

    const paidTotalCall = pool.query.mock.calls.find(([sql]) => /SUM\(ROUND/.test(sql));
    expect(paidTotalCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(paidTotalCall[1]).toEqual(['2026-09-01', '2026-09-30', 5]);
  });

  test('ap block reports hours companions (total_time/60) alongside the dollar totals', async () => {
    const heldSession = {
      id: 1, total_time: 90, billing_status: 'on_hold', service_date: '2026-09-15',
      eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 5,
      pay_rate: '40', role: 'practitioner',
    };
    deriveEimsStatus.mockReturnValue({ tier: 'exception', label: 'Held' });

    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY service_date/.test(sql)) return { rows: [] };
      if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(total_time\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/SUM\(ROUND/.test(sql)) return { rows: [{ total: '60.00', hours: '1.00' }] };
      if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(a\.total_time\)[\s\S]*bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 1, hours: '1' }] };
      if (/a\.billing_status IN \('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined'\)/.test(sql)) return { rows: [] };
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [] };
      if (/JOIN practitioners p ON p\.id = a\.practitioner_id\s+LEFT JOIN billing_batches/.test(sql)) return { rows: [heldSession] };
      if (/COUNT\(DISTINCT patient_id\)/.test(sql)) return { rows: [{ count: 0 }] };
      return { rows: [] };
    });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getMonthOverview({ query: { month: '2026-09' } }, res);

    const { ap } = res.json.mock.calls[0][0];
    // 90 min on_hold session -> 1.5 hrs, all held (not cleared)
    expect(ap).toMatchObject({
      totalOwedHours: 1.5, totalClearHours: 0, totalHeldHours: 1.5, totalPaidHours: 1,
    });
  });
});
