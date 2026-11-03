// The Overview verdict banner was reading "all clear" / "nothing waiting on
// you" for a month that actually had open declined sessions and unreviewed
// sessions with a real EIMS mismatch already on file — both silently
// excluded from flaggedCount/totalHeld. These tests pin the fix: declined
// counts as an open exception everywhere on_hold/rejected already do, and a
// 'pending' session the last compliance run actually flagged counts as
// needing a decision too (a 'pending' session that was never checked does
// not, same PENDING_CHECKED_SQL rule the EIMS donut already uses).
//
// Declined/rejected only count toward flaggedCount/flaggedHours though —
// they are deliberately excluded from the "What needs you" card's own
// session LIST (WORKLIST_STATUSES = ['on_hold']), since the dedicated
// "Returned & declined logs" card already lists them; including them in
// both places just duplicated every row.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/fieldEncryption', () => ({ decryptField: (v) => v }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn().mockReturnValue({ tier: 'cleared' }),
  formatInvoiceNumber: (id) => `INV-${id}`,
}));

const { pool } = require('../../config/db');
const { getDayOverview, getMonthOverview, DASHBOARD_CARD_KEYS } = require('../dashboardController');

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

beforeEach(() => pool.query.mockReset());

describe('getDayOverview counts declined and flagged-pending sessions as open', () => {
  test('exceptionCountRows query includes declined, but the exceptionRows LIST query does not (that is Returned & declined logs\' job)', async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (/completed_at::date = CURRENT_DATE/.test(sql)) return { rows: [{ count: 0, practitioners: 0 }] };
      if (/ORDER BY COALESCE\(a\.held_at, a\.rejected_at\) ASC/.test(sql)) {
        expect(params[0]).toEqual(['on_hold']);
        return { rows: [] };
      }
      if (/billing_status = ANY\(\$1::text\[\]\)/.test(sql)) {
        expect(params[0]).toEqual(expect.arrayContaining(['on_hold', 'rejected', 'declined']));
        return { rows: [{ count: 0, hours: '0' }] };
      }
      if (/a\.billing_status = 'pending'/.test(sql) && /COUNT\(\*\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    await getDayOverview({ query: { month: '2026-04' } }, mkRes());
  });

  test('a declined session counts toward flaggedCount/flaggedHours but is absent from flaggedSessions (already shown in Returned & declined logs)', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/completed_at::date = CURRENT_DATE/.test(sql)) return { rows: [{ count: 0, practitioners: 0 }] };
      // The worklist (on_hold-only) query returns nothing — no declined row here.
      if (/ORDER BY COALESCE\(a\.held_at, a\.rejected_at\) ASC/.test(sql)) return { rows: [] };
      // The count query (on_hold+rejected+declined) sees the one declined session.
      if (/billing_status = ANY\(\$1::text\[\]\)/.test(sql)) return { rows: [{ count: 1, hours: '1' }] };
      if (/a\.billing_status = 'pending'/.test(sql) && /COUNT\(\*\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = mkRes();
    await getDayOverview({ query: { month: '2026-04' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.flaggedCount).toBe(1);
    expect(body.flaggedHours).toBe(1);
    expect(body.flaggedSessions.find((s) => s.id === 9)).toBeUndefined();
  });

  test('a pending session the last compliance run flagged counts toward flaggedCount, with status eims_mismatch', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/completed_at::date = CURRENT_DATE/.test(sql)) return { rows: [{ count: 0, practitioners: 0 }] };
      if (/ORDER BY COALESCE\(a\.held_at, a\.rejected_at\) ASC/.test(sql)) return { rows: [] };
      if (/billing_status = ANY\(\$1::text\[\]\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/a\.billing_status = 'pending'/.test(sql) && /COUNT\(\*\)/.test(sql)) return { rows: [{ count: 1, hours: '0.5' }] };
      if (/a\.billing_status = 'pending'/.test(sql)) {
        return { rows: [{
          id: 42, service_date: '2026-04-10', eims_last_flagged: true, eims_last_missing: false,
          patient_first_name: 'E', patient_last_name: 'F',
          practitioner_first_name: 'G', practitioner_last_name: 'H',
          total_time: 30, pay_rate: 50,
        }] };
      }
      return { rows: [] };
    });
    const res = mkRes();
    await getDayOverview({ query: { month: '2026-04' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.flaggedCount).toBe(1);
    expect(body.flaggedHours).toBe(0.5);
    const flaggedRow = body.flaggedSessions.find((s) => s.id === 42);
    expect(flaggedRow.status).toBe('eims_mismatch');
    expect(flaggedRow.note).toBe('Not matching EIMS');
    expect(flaggedRow.hours).toBe(0.5);
  });

  test('the pending-flagged query requires eims_last_flagged/eims_last_missing to actually be true, not just non-null', async () => {
    // eims_last_flagged/eims_last_missing are booleans: a checked-and-clean
    // session has eims_last_flagged = false, which is non-null but not a
    // real flag. Asserting "= true" in the SQL (not "IS NOT NULL") is what
    // keeps every reviewed-and-clean pending session out of flaggedCount —
    // this regressed once already (432 clean-but-unreviewed sessions all
    // counted as "needing a decision").
    pool.query.mockImplementation(async (sql) => {
      if (/completed_at::date = CURRENT_DATE/.test(sql)) return { rows: [{ count: 0, practitioners: 0 }] };
      if (/ORDER BY COALESCE\(a\.held_at, a\.rejected_at\) ASC/.test(sql)) return { rows: [] };
      if (/billing_status = ANY\(\$1::text\[\]\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/a\.billing_status = 'pending'/.test(sql) && /COUNT\(\*\)/.test(sql)) {
        expect(sql).toMatch(/eims_last_flagged = true/);
        expect(sql).toMatch(/eims_last_missing = true/);
        expect(sql).not.toMatch(/eims_last_flagged IS NOT NULL/);
        return { rows: [{ count: 0, hours: '0' }] };
      }
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = mkRes();
    await getDayOverview({ query: { month: '2026-04' } }, res);
    expect(res.json.mock.calls[0][0].flaggedCount).toBe(0);
  });
});

describe('getMonthOverview AP totals treat declined as an open exception', () => {
  test('a declined session counts toward totalHeld, not silently dropped from totalOwed', async () => {
    const declinedSession = {
      id: 5, total_time: 60, billing_status: 'declined', service_date: '2026-04-05',
      eims_missing_status: null, eims_entered_at: null, is_override: false, practitioner_id: 1,
      pay_rate: '40', role: 'practitioner',
    };
    pool.query.mockImplementation(async (sql) => {
      if (/SUM\(ROUND/.test(sql)) return { rows: [{ total: '0', hours: '0' }] };
      if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(a\.total_time\)[\s\S]*bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/GROUP BY service_date/.test(sql)) return { rows: [] };
      if (/COUNT\(\*\)::int AS count, COALESCE\(SUM\(total_time\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/a\.billing_status IN \('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined'\)/.test(sql)) return { rows: [] };
      if (/a\.billing_status = 'pending'/.test(sql)) return { rows: [] };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [] };
      if (/JOIN practitioners p ON p\.id = a\.practitioner_id\s+LEFT JOIN billing_batches/.test(sql)) return { rows: [declinedSession] };
      if (/COUNT\(DISTINCT patient_id\)/.test(sql)) return { rows: [{ count: 0 }] };
      return { rows: [] };
    });
    const res = mkRes();
    await getMonthOverview({ query: { month: '2026-04' } }, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.ap.totalOwed).toBe(40);
    expect(body.ap.totalHeld).toBe(40);
    expect(body.ap.totalClear).toBe(0);
  });
});

describe('DASHBOARD_CARD_KEYS no longer includes the removed accuracy_table card', () => {
  test('is the fixed 8-key set', () => {
    expect(DASHBOARD_CARD_KEYS).toEqual([
      'billing_pipeline', 'action_queue', 'services_breakdown', 'documents_feed',
      'eims_status', 'returned_logs', 'trajectory_chart', 'county_hours',
    ]);
  });
});
