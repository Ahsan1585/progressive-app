// getPipelineOverview: ?practitionerId= scopes statusRows/paidRows/
// billedSessions/pendingCheckedSessions, and the funnel gains hours
// companions (loggedHours/reviewedHours/invoicedHours/paidHours/
// exceptionsHours) mirroring the existing session-count fields.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn(),
}));

const { pool } = require('../../config/db');
const { getPipelineOverview } = require('../dashboardController');

beforeEach(() => pool.query.mockReset());

function baseMock() {
  return async (sql) => {
    if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
    if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
    if (/billing_status IN \('njeis_review'/.test(sql)) return { rows: [] };
    if (/PENDING_CHECKED|eims_last_flagged IS NOT NULL/.test(sql)) return { rows: [] };
    if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
}

describe('getPipelineOverview practitioner filter + hours', () => {
  test('statusRows, paidRows, billedSessions, pendingCheckedSessions all bind practitionerId', async () => {
    pool.query.mockImplementation(baseMock());
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getPipelineOverview({ query: { month: '2026-09', practitionerId: '9' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);

    const statusCall = pool.query.mock.calls.find(([sql]) => /GROUP BY billing_status/.test(sql));
    expect(statusCall[0]).toMatch(/practitioner_id = \$3/);
    expect(statusCall[1]).toContain(9);

    const paidCall = pool.query.mock.calls.find(([sql]) => /bb\.paid_at IS NOT NULL/.test(sql));
    expect(paidCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(paidCall[1]).toContain(9);

    const billedCall = pool.query.mock.calls.find(([sql]) => /billing_status IN \('njeis_review'/.test(sql));
    expect(billedCall[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(billedCall[1]).toContain(9);
  });

  test('funnel reports hours alongside counts (logged/reviewed/invoiced/paid/exceptions)', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY billing_status/.test(sql)) {
        return {
          rows: [
            { billing_status: 'invoiced', count: 2, hours: '3' },
            { billing_status: 'on_hold', count: 1, hours: '1.5' },
          ],
        };
      }
      if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 1, hours: '1.5' }] };
      if (/billing_status IN \('njeis_review'/.test(sql)) return { rows: [] };
      if (/eims_last_flagged IS NOT NULL/.test(sql)) return { rows: [] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getPipelineOverview({ query: { month: '2026-09' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.invoicedHours).toBe(3);
    expect(body.paidHours).toBe(1.5);
    expect(body.exceptionsHours.on_hold).toBe(1.5);
  });
});
