// getMonthOverview: ?practitionerId= scopes every remaining query
// (volume, funnel, paid count, billed/pending-checked sessions feeding
// practitionerAccuracy, the per-practitioner table), and
// practitionerAccuracy rows gain hoursChecked/notCleanHours companions.
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

function baseMock({ billed = [], pendingChecked = [], practitionerRoles = [] } = {}) {
  return async (sql) => {
    if (/GROUP BY service_date/.test(sql)) return { rows: [] };
    if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(total_time\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
    if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
    if (/SUM\(ROUND/.test(sql)) return { rows: [{ total: '0', hours: '0' }] };
    if (/COUNT\(\*\)::int AS count[\s\S]*bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0 }] };
    if (/a\.billing_status IN \('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined'\)/.test(sql)) return { rows: billed };
    if (/a\.billing_status = 'pending'/.test(sql)) return { rows: pendingChecked };
    if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: practitionerRoles };
    if (/JOIN practitioners p ON p\.id = a\.practitioner_id\s+LEFT JOIN billing_batches/.test(sql)) return { rows: [] };
    if (/COUNT\(DISTINCT patient_id\)/.test(sql)) return { rows: [{ count: 0 }] };
    if (/GROUP BY a\.practitioner_id, p\.first_name/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
}

describe('getMonthOverview: remaining queries get the practitioner filter', () => {
  test('volume, funnel, paid-count, billed/pending-checked, and practitioner-table queries all bind practitionerId', async () => {
    pool.query.mockImplementation(baseMock());
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getMonthOverview({ query: { month: '2026-09', practitionerId: '7' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);

    const volumeCalls = pool.query.mock.calls.filter(([sql]) =>
      /COUNT\(\*\)::int AS count, COALESCE\(SUM\(total_time\)/.test(sql)
    );
    expect(volumeCalls.length).toBeGreaterThan(0);
    volumeCalls.forEach(([sql, params]) => {
      expect(sql).toMatch(/practitioner_id = \$3/);
      expect(params).toContain(7);
    });

    const funnelCall = pool.query.mock.calls.find(([sql]) => /GROUP BY billing_status/.test(sql));
    expect(funnelCall[0]).toMatch(/practitioner_id = \$3/);
    expect(funnelCall[1]).toContain(7);

    const paidCall = pool.query.mock.calls.find(([sql]) => /COUNT\(\*\)::int AS count[\s\S]*bb\.paid_at IS NOT NULL/.test(sql));
    expect(paidCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(paidCall[1]).toContain(7);

    const billedCall = pool.query.mock.calls.find(([sql]) => /a\.billing_status IN \('njeis_review', 'invoiced'/.test(sql));
    expect(billedCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(billedCall[1]).toContain(7);

    const pendingCall = pool.query.mock.calls.find(([sql]) => /a\.billing_status = 'pending'/.test(sql));
    expect(pendingCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(pendingCall[1]).toContain(7);

    const tableCall = pool.query.mock.calls.find(([sql]) => /GROUP BY a\.practitioner_id, p\.first_name/.test(sql));
    expect(tableCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(tableCall[1]).toContain(7);
  });

  test('practitionerAccuracy rows report hoursChecked (from billed sessions\' total_time)', async () => {
    const billed = [
      { id: 1, billing_status: 'njeis_review', eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 1, total_time: 60, service_date: '2026-09-01' },
      { id: 2, billing_status: 'njeis_review', eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 1, total_time: 30, service_date: '2026-09-02' },
    ];
    deriveEimsStatus.mockReturnValue({ tier: 'cleared', label: 'Matched' });
    pool.query.mockImplementation(baseMock({
      billed,
      practitionerRoles: [{ id: 1, role: 'practitioner', first_name: 'Omar', last_name: 'Abernathy', position_title: 'OT' }],
    }));

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getMonthOverview({ query: { month: '2026-09' } }, res);

    const row = res.json.mock.calls[0][0].practitionerAccuracy.find((r) => r.practitionerId === 1);
    // 60 + 30 minutes = 1.5 hrs checked, all clean so notCleanHours = 0
    expect(row).toMatchObject({ sessionsChecked: 2, hoursChecked: 1.5, notClean: 0, notCleanHours: 0 });
  });

  test('a notClean session contributes to notCleanHours', async () => {
    const billed = [
      { id: 1, billing_status: 'on_hold', eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 1, total_time: 90, service_date: '2026-09-01' },
    ];
    deriveEimsStatus.mockReturnValue({ tier: 'exception', label: 'Held' });
    pool.query.mockImplementation(baseMock({
      billed,
      practitionerRoles: [{ id: 1, role: 'practitioner', first_name: 'Omar', last_name: 'Abernathy', position_title: 'OT' }],
    }));

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getMonthOverview({ query: { month: '2026-09' } }, res);

    const row = res.json.mock.calls[0][0].practitionerAccuracy.find((r) => r.practitionerId === 1);
    expect(row).toMatchObject({ sessionsChecked: 1, hoursChecked: 1.5, notClean: 1, notCleanHours: 1.5 });
  });
});
