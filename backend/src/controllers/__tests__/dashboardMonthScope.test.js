// Every card below the Overview stat row must follow the selected month, the
// same way the stat row does: by the session's service date. Without a month
// the endpoints keep their all-time behavior (the verdict banner relies on it).
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn().mockReturnValue({ tier: 'cleared' }),
  formatInvoiceNumber: (id) => `INV-${id}`,
}));

const { pool } = require('../../config/db');
const {
  getDayOverview, getReturnedLogs, getPipelineOverview, getDocumentsFeed, getAccountsPayable,
} = require('../dashboardController');

beforeEach(() => {
  pool.query.mockReset();
  // Every query returns an empty result with the shapes the handlers read.
  pool.query.mockResolvedValue({ rows: [{ count: 0, practitioners: 0 }] });
});

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });
const callsMatching = (re) => pool.query.mock.calls.filter(([sql]) => re.test(sql));
const hasRange = (call, start, end) => call[1].includes(start) && call[1].includes(end);

describe('getDayOverview (What needs you)', () => {
  test('month=2026-10 limits both the list and its count to that month', async () => {
    await getDayOverview({ query: { month: '2026-10' } }, mkRes());
    const list = callsMatching(/FROM assessments a\s+JOIN practitioners p[\s\S]*billing_status = ANY/)[0];
    const count = callsMatching(/SELECT COUNT\(\*\)::int AS count, COALESCE\(SUM\(total_time\)[\s\S]*FROM assessments WHERE billing_status = ANY/)[0];
    expect(list[0]).toMatch(/service_date/);
    expect(hasRange(list, '2026-10-01', '2026-10-31')).toBe(true);
    expect(hasRange(count, '2026-10-01', '2026-10-31')).toBe(true);
  });

  test('no month (the verdict banner) stays all-time: the range is null', async () => {
    await getDayOverview({ query: {} }, mkRes());
    const list = callsMatching(/billing_status = ANY/)[0];
    expect(list[1].slice(1)).toEqual([null, null]);
    await getDayOverview({}, mkRes()); // a bare request must not throw either
  });
});

describe('getReturnedLogs', () => {
  test('month=2026-02 uses the real last day of February', async () => {
    await getReturnedLogs({ query: { month: '2026-02' } }, mkRes());
    const q = callsMatching(/billing_status IN \('rejected', 'declined'\)/)[0];
    expect(q[0]).toMatch(/service_date/);
    expect(q[1]).toEqual(['2026-02-01', '2026-02-28']);
  });

  test('no month stays all-time', async () => {
    await getReturnedLogs({ query: {} }, mkRes());
    expect(callsMatching(/billing_status IN \('rejected', 'declined'\)/)[0][1]).toEqual([null, null]);
  });
});

describe('getPipelineOverview (billing pipeline + EIMS match)', () => {
  test('month=2026-10 scopes the status counts, the paid count and the EIMS sample', async () => {
    await getPipelineOverview({ query: { month: '2026-10' } }, mkRes());
    const statuses = callsMatching(/GROUP BY billing_status/)[0];
    const paid = callsMatching(/bb\.paid_at IS NOT NULL/)[0];
    const billed = callsMatching(/ORDER BY a\.service_date DESC/)[0];
    for (const q of [statuses, paid, billed]) {
      expect(q[0]).toMatch(/service_date/);
      expect(q[1]).toEqual(['2026-10-01', '2026-10-31']);
    }
  });

  test('no month stays all-time', async () => {
    await getPipelineOverview({ query: {} }, mkRes());
    for (const q of [callsMatching(/GROUP BY billing_status/)[0], callsMatching(/bb\.paid_at IS NOT NULL/)[0], callsMatching(/ORDER BY a\.service_date DESC/)[0]]) {
      expect(q[1]).toEqual([null, null]);
    }
  });

  test('a December month ends on the 31st of that same year', async () => {
    await getPipelineOverview({ query: { month: '2025-12' } }, mkRes());
    expect(callsMatching(/GROUP BY billing_status/)[0][1]).toEqual(['2025-12-01', '2025-12-31']);
  });
});

describe('getDocumentsFeed (Invoices & SEVF forms)', () => {
  test('month=2026-10 lists only documents that cover sessions in that month', async () => {
    await getDocumentsFeed({ query: { month: '2026-10' } }, mkRes());
    const q = callsMatching(/FROM billing_batches bb/)[0];
    expect(q[0]).toMatch(/EXISTS \(\s*SELECT 1 FROM assessments x[\s\S]*x\.service_date/);
    expect(q[1]).toEqual(['2026-10-01', '2026-10-31']);
    expect(q[0]).toMatch(/LIMIT 50/);
  });

  test('no month keeps the "latest 20" behavior', async () => {
    await getDocumentsFeed({ query: {} }, mkRes());
    const q = callsMatching(/FROM billing_batches bb/)[0];
    expect(q[1]).toEqual([null, null]);
    expect(q[0]).toMatch(/LIMIT 20/);
  });
});

describe('a malformed month never breaks the card', () => {
  test('falls back to the current month, like the other dashboard endpoints', async () => {
    await getReturnedLogs({ query: { month: 'garbage' } }, mkRes());
    const [start, end] = callsMatching(/billing_status IN \('rejected', 'declined'\)/)[0][1];
    expect(start).toMatch(/^\d{4}-\d{2}-01$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the pipeline funnel never shrinks going down', () => {
  test('Logged counts held, returned and declined sessions too, so it is never below Reviewed', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY billing_status/.test(sql)) {
        return { rows: [
          { billing_status: 'pending', count: 2 }, { billing_status: 'invoiced', count: 1 },
          { billing_status: 'on_hold', count: 3 }, { billing_status: 'rejected', count: 1 }, { billing_status: 'declined', count: 1 },
        ] };
      }
      if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0 }] };
      return { rows: [] };
    });
    const res = mkRes();
    await getPipelineOverview({ query: {} }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.logged).toBe(8); // 2 pending + 1 invoiced + 3 held + 1 returned + 1 declined
    expect(out.logged).toBeGreaterThanOrEqual(out.reviewed);
    expect(out.reviewed).toBeGreaterThanOrEqual(out.invoiced);
    expect(out.invoiced).toBeGreaterThanOrEqual(out.paid);
  });
});

describe('getAccountsPayable (the banner money)', () => {
  test('month=2026-02 limits what is owed and held to that month', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await getAccountsPayable({ query: { month: '2026-02' } }, mkRes());
    const q = pool.query.mock.calls[0];
    expect(q[0]).toMatch(/a\.service_date >= \$1::date/);
    expect(q[1]).toEqual(['2026-02-01', '2026-02-28']);
  });

  test('no month keeps it all-time', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await getAccountsPayable({ query: {} }, mkRes());
    expect(pool.query.mock.calls[0][1]).toEqual([null, null]);
  });
});
