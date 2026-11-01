// The verdict banner's "N hrs invoiced" figure (CompanyDashboard.jsx's
// totalBilledHours) was built from ap.totalOwedHours + ap.totalPaidHours.
// totalOwedHours' underlying query deliberately includes on_hold/rejected
// sessions' hours (so "money that still needs a decision" covers them) —
// but those sessions were never actually invoiced, so folding their hours
// into a figure labeled "invoiced" overcounts it relative to the Billing
// pipeline's own "Invoiced" stage (byStatus.invoiced + byStatus.completed),
// which correctly excludes on_hold/rejected. ap.invoicedHours gives the
// banner a true invoiced-only figure that matches the pipeline exactly.
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

describe('getMonthOverview ap.invoicedHours', () => {
  test('excludes on_hold/rejected hours that totalOwedHours folds in', async () => {
    // One unpaid invoiced session (2 hrs) and one on_hold session (1 hr).
    // totalOwedHours counts both (3 hrs, "needs a decision"), but
    // invoicedHours must count only the invoiced one (2 hrs) — on_hold was
    // never invoiced.
    const invoicedSession = {
      id: 1, total_time: 120, billing_status: 'invoiced', service_date: '2026-09-15',
      eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 1,
      pay_rate: '40', role: 'practitioner',
    };
    const heldSession = {
      id: 2, total_time: 60, billing_status: 'on_hold', service_date: '2026-09-16',
      eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 1,
      pay_rate: '40', role: 'practitioner',
    };
    deriveEimsStatus.mockReturnValue({ tier: 'cleared', label: 'Matched' });

    pool.query.mockImplementation(async (sql) => {
      if (/SUM\(ROUND/.test(sql)) return { rows: [{ total: '0', hours: '0' }] };
      if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(a\.total_time\)[\s\S]*bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/GROUP BY service_date/.test(sql)) return { rows: [] };
      if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(total_time\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/a\.billing_status IN \('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined'\)/.test(sql)) return { rows: [] };
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [] };
      if (/JOIN practitioners p ON p\.id = a\.practitioner_id\s+LEFT JOIN billing_batches/.test(sql)) return { rows: [invoicedSession, heldSession] };
      if (/COUNT\(DISTINCT patient_id\)/.test(sql)) return { rows: [{ count: 0 }] };
      return { rows: [] };
    });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getMonthOverview({ query: { month: '2026-09' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const { ap } = res.json.mock.calls[0][0];
    expect(ap.totalOwedHours).toBe(3);
    expect(ap.invoicedHours).toBe(2);
  });
});
