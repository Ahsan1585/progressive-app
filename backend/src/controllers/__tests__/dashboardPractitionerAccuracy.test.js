// Practitioner accuracy table (CompanyDashboard's "Practitioner accuracy"
// card): notClean must count every session dragging the score down, not
// just the on_hold/rejected/declined subset — a still-pending session
// that's flagged/mismatched or missing in EIMS also counts against
// accuracyPct (see the comment above accuracyByPractitioner in
// dashboardController.js) without being on_hold/rejected/declined, so
// heldOrReturned alone didn't reconcile with the percentage shown.
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

describe('getMonthOverview practitionerAccuracy', () => {
  test('notClean counts flagged/unverified sessions too, not just held/rejected/declined', async () => {
    // Marcus Lombardi: 8 billed sessions, 0 on_hold/rejected/declined, but
    // 1 flagged (pending/mismatch tier) — accuracyPct is 7/8 = 87.5%, so
    // notClean must be 1 even though heldOrReturned is 0.
    const billed = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1, billing_status: 'njeis_review', practitioner_id: 1, total_time: 60, service_date: '2026-02-01',
    }));
    const byId = Object.fromEntries(billed.map((s) => [s.id, { tier: 'cleared', label: 'Matched' }]));
    byId[8] = { tier: 'pending', label: 'Mismatch' }; // flagged, but never on_hold/rejected/declined
    deriveEimsStatus.mockImplementation((s) => byId[s.id]);

    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY service_date/.test(sql)) return { rows: [] };
      if (/FROM assessments WHERE service_date/.test(sql) && /COUNT\(\*\)::int AS count FROM assessments WHERE/.test(sql)) return { rows: [{ count: 0 }] };
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0 }] };
      if (/a\.billing_status IN \('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined'\)/.test(sql)) return { rows: billed };
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [{ id: 1, role: 'practitioner', first_name: 'Marcus', last_name: 'Lombardi', position_title: 'Social Worker' }] };
      if (/JOIN practitioners p ON p\.id = a\.practitioner_id\s+WHERE a\.service_date/.test(sql)) return { rows: [] };
      if (/COUNT\(DISTINCT patient_id\)/.test(sql)) return { rows: [{ count: 0 }] };
      if (/LEFT JOIN billing_batches bb ON bb\.id = a\.billing_batch_id/.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getMonthOverview({ query: { month: '2026-02' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const row = res.json.mock.calls[0][0].practitionerAccuracy.find((r) => r.practitionerId === 1);
    expect(row).toMatchObject({
      sessionsChecked: 8,
      heldOrReturned: 0,
      notClean: 1,
      accuracyPct: 87.5,
    });
  });
});
