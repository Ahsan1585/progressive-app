// getPipelineOverview's eimsMatchRate (backs the Overview's EIMS donut)
// gains an hours companion per tier, mirroring its existing session
// counts, so the sessions/hours toggle applies to the donut's legend too.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn(),
}));

const { pool } = require('../../config/db');
const { deriveEimsStatus } = require('../../utils/invoiceData');
const { getPipelineOverview } = require('../dashboardController');

beforeEach(() => pool.query.mockReset());

describe('getPipelineOverview eimsMatchRate hours', () => {
  test('matched/flagged/missing/unverified each get an hours sibling', async () => {
    const matchedSession = { id: 1, billing_status: 'invoiced', practitioner_id: 1, total_time: 60, service_date: '2026-09-01' };
    deriveEimsStatus.mockReturnValue({ tier: 'cleared', label: 'Matched' });

    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/billing_status IN \('njeis_review'/.test(sql)) return { rows: [matchedSession] };
      if (/eims_last_flagged IS NOT NULL/.test(sql)) return { rows: [] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [{ id: 1, role: 'practitioner' }] };
      return { rows: [] };
    });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getPipelineOverview({ query: { month: '2026-09' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.eimsMatchRate).toMatchObject({ matched: 1 });
    expect(body.eimsMatchRateHours).toMatchObject({ matched: 1 });
  });

  // A still-pending session with a persisted "missing in EIMS" verdict
  // (eims_last_missing) is bucketed by pendingEimsBucket, not deriveEimsStatus
  // — so it never goes through billedSessions, whose query does select
  // total_time. The separate pendingCheckedSessions query must select
  // total_time too, or every pending session's hours silently round to 0
  // while its session count is still correct (the donut then shows "2
  // sessions" but "0 hrs" for the same bucket).
  test('a pending session missing from EIMS contributes its real hours, not 0', async () => {
    const pendingMissingSession = {
      practitioner_id: 1, eims_last_flagged: null, eims_last_missing: '2026-05-01T00:00:00Z', total_time: 30,
    };

    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/billing_status IN \('njeis_review'/.test(sql)) return { rows: [] };
      if (/eims_last_flagged IS NOT NULL/.test(sql)) return { rows: [pendingMissingSession] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [{ id: 1, role: 'practitioner' }] };
      return { rows: [] };
    });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getPipelineOverview({ query: { month: '2026-05' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.eimsMatchRate).toMatchObject({ missing: 1 });
    expect(body.eimsMatchRateHours).toMatchObject({ missing: 0.5 });

    // Prove the fixture's total_time is actually reachable from the real
    // SQL column list, not just injected into the mock row — otherwise the
    // assertions above pass even if the real query never selects it.
    const [pendingSql] = pool.query.mock.calls.find(([sql]) => /eims_last_flagged IS NOT NULL/.test(sql));
    expect(pendingSql).toMatch(/total_time/);
  });
});
