// The EIMS match ring: which sessions count as matched, missing from EIMS,
// unverified, or flagged. "Missing" used to stay at 0 forever, because sessions
// the status logic labels Missing were lumped into "Mismatch / pending".
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn(),
  formatInvoiceNumber: (id) => `INV-${id}`,
}));

const { pool } = require('../../config/db');
const { deriveEimsStatus } = require('../../utils/invoiceData');
const { getPipelineOverview, eimsBucket, pendingEimsBucket } = require('../dashboardController');

beforeEach(() => {
  pool.query.mockReset();
  deriveEimsStatus.mockReset();
});

describe('eimsBucket', () => {
  test.each([
    // [derived, humanHold, alreadyBilled, expected]
    [{ tier: 'cleared', label: 'Matched', hasOverride: false }, false, false, 'matched'],
    [{ tier: 'cleared', label: 'Approved', hasOverride: false }, false, false, 'matched'],
    [{ tier: 'cleared', label: 'Override', hasOverride: false }, false, false, 'matched'],
    [{ tier: 'exception', label: 'Missing', hasOverride: false }, false, false, 'missing'],
    [{ tier: 'pending', label: 'Awaiting', hasOverride: false }, false, false, 'missing'], // missing, sent to an admin for approval
    [{ tier: 'unverified', label: 'Unverified', hasOverride: false }, false, false, null], // dropped from the chart, not counted
    [{ tier: 'pending', label: 'Mismatch', hasOverride: false }, false, false, 'flagged'], // not yet billed: still blocking
    [{ tier: 'exception', label: 'Duplicate', hasOverride: false }, false, false, 'flagged'],
    [{ tier: 'exception', label: 'Rejected', hasOverride: false }, false, false, 'flagged'],
    [{ tier: 'pending', label: 'Not entered', hasOverride: false }, false, false, 'flagged'], // independent, not yet entered
    // Already billed (invoiced/completed/self_certified) + genuinely unresolved
    // mismatch (no override anywhere on the session) -> the new bucket.
    [{ tier: 'pending', label: 'Mismatch', hasOverride: false }, false, true, 'billedUnresolved'],
    // Already billed, but SOME field on the session has an override on file
    // (even if the session is still flagged overall) -> stays 'flagged', not
    // 'billedUnresolved' — "nothing on file" is specifically what the new
    // bucket means.
    [{ tier: 'pending', label: 'Mismatch', hasOverride: true }, false, true, 'flagged'],
    // alreadyBilled is irrelevant to every non-"unresolved mismatch" verdict.
    [{ tier: 'cleared', label: 'Matched', hasOverride: false }, false, true, 'matched'],
    [{ tier: 'exception', label: 'Missing', hasOverride: false }, false, true, 'missing'],
    // A human hold/return/decline is flagged whatever EIMS says, even "Missing",
    // and even if it's one of the statuses that would otherwise count as billed.
    [{ tier: 'exception', label: 'Missing', hasOverride: false }, true, false, 'flagged'],
    [{ tier: 'cleared', label: 'Matched', hasOverride: false }, true, false, 'flagged'],
    [{ tier: 'pending', label: 'Mismatch', hasOverride: false }, true, true, 'flagged'],
  ])('%j (held=%s, billed=%s) -> %s', (derived, held, billed, expected) => {
    expect(eimsBucket(derived, held, billed)).toBe(expected);
  });
});

describe('getPipelineOverview EIMS ring', () => {
  test('counts missing sessions under missing, not under mismatch/pending; drops unverified; splits billed-unresolved from flagged', async () => {
    const billed = [
      { id: 1, billing_status: 'invoiced', practitioner_id: 1 },
      { id: 2, billing_status: 'invoiced', practitioner_id: 1 },
      { id: 3, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 4, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 5, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 6, billing_status: 'njeis_review', practitioner_id: 1 }, // not yet billed, mismatch -> flagged
      { id: 7, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 8, billing_status: 'on_hold', practitioner_id: 1 },
      { id: 9, billing_status: 'invoiced', practitioner_id: 1 }, // already billed, mismatch, no override -> billedUnresolved
    ];
    const byId = {
      1: { tier: 'cleared', label: 'Matched', hasOverride: false },
      2: { tier: 'cleared', label: 'Approved', hasOverride: false },
      3: { tier: 'exception', label: 'Missing', hasOverride: false },
      4: { tier: 'pending', label: 'Awaiting', hasOverride: false },
      5: { tier: 'unverified', label: 'Unverified', hasOverride: false },
      6: { tier: 'pending', label: 'Mismatch', hasOverride: false },
      7: { tier: 'exception', label: 'Duplicate', hasOverride: false },
      9: { tier: 'pending', label: 'Mismatch', hasOverride: false },
    };
    deriveEimsStatus.mockImplementation((s) => byId[s.id] || { tier: 'exception', label: 'Missing', hasOverride: false });
    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0 }] };
      if (/ORDER BY a\.service_date DESC/.test(sql)) return { rows: billed };
      if (/FROM practitioners/.test(sql)) return { rows: [{ id: 1, role: 'practitioner' }] };
      return { rows: [] };
    });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getPipelineOverview({ query: {} }, res);
    expect(res.json.mock.calls[0][0].eimsMatchRate).toEqual({
      matched: 2,
      missing: 2, // Missing + Awaiting
      flagged: 3, // Mismatch(#6, not yet billed) + Duplicate + the on-hold session
      billedUnresolved: 1, // Mismatch(#9, already invoiced, no override)
    });
  });
});

// Sessions still pending review whose last Compliance Analysis verdict is on
// file (eims_last_missing / eims_last_flagged). Billing's "N missing in EIMS"
// badge counts exactly these, so the ring has to as well.
describe('pendingEimsBucket', () => {
  test.each([
    [{ eims_last_missing: true, eims_last_flagged: false }, 'missing'],
    [{ eims_last_missing: true, eims_last_flagged: true }, 'missing'], // no record at all wins over a field mismatch
    [{ eims_last_missing: false, eims_last_flagged: true }, 'flagged'],
    [{ eims_last_missing: false, eims_last_flagged: false }, 'matched'], // checked and clean
    [{ eims_last_missing: null, eims_last_flagged: false }, 'matched'],
  ])('%j -> %s', (row, expected) => {
    expect(pendingEimsBucket(row)).toBe(expected);
  });
});

describe('getPipelineOverview includes checked pending sessions', () => {
  function prime({ billed = [], pending = [], roles = [{ id: 1, role: 'practitioner' }] } = {}) {
    deriveEimsStatus.mockImplementation(() => ({ tier: 'cleared', label: 'Matched', hasOverride: false }));
    pool.query.mockImplementation(async (sql) => {
      if (/GROUP BY billing_status/.test(sql)) return { rows: [] };
      if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0 }] };
      if (/billing_status = 'pending'/.test(sql)) return { rows: pending };
      if (/ORDER BY a\.service_date DESC/.test(sql)) return { rows: billed };
      if (/FROM practitioners/.test(sql)) return { rows: roles };
      return { rows: [] };
    });
  }
  const run = async (query = {}) => {
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getPipelineOverview({ query }, res);
    return res.json.mock.calls[0][0].eimsMatchRate;
  };

  test('a pending session found missing shows up under Missing in EIMS, as it does in Billing', async () => {
    prime({
      billed: [{ id: 1, billing_status: 'invoiced', practitioner_id: 1 }],
      pending: [
        { practitioner_id: 1, eims_last_missing: true, eims_last_flagged: false },
        { practitioner_id: 1, eims_last_missing: false, eims_last_flagged: true },
        { practitioner_id: 1, eims_last_missing: false, eims_last_flagged: false },
      ],
    });
    expect(await run()).toEqual({ matched: 2, flagged: 1, missing: 1, billedUnresolved: 0 });
  });

  test('independent practitioners (self-reported) are left out, like the accuracy table', async () => {
    prime({
      pending: [{ practitioner_id: 2, eims_last_missing: true, eims_last_flagged: false }],
      roles: [{ id: 2, role: 'independent_practitioner' }],
    });
    expect(await run()).toEqual({ matched: 0, flagged: 0, missing: 0, billedUnresolved: 0 });
  });

  test('the pending query only returns sessions that were actually checked, and follows the month', async () => {
    prime();
    await run({ month: '2026-10' });
    const call = pool.query.mock.calls.find(([sql]) => /billing_status = 'pending'/.test(sql));
    expect(call[0]).toMatch(/eims_last_flagged IS NOT NULL OR a\.eims_last_missing IS NOT NULL/);
    expect(call[0]).toMatch(/service_date/);
    expect(call[1]).toEqual(['2026-10-01', '2026-10-31']);
  });
});

// deriveEimsStatus treats a session with no total_time as a zero-length
// "Cancelled" visit and clears it. If the query that feeds it never loads
// total_time, EVERY billed session looks cancelled and counts as matched, which
// is why the ring said ~98% matched and could never show a missing session.
describe('billed sessions are loaded with their duration', () => {
  test('the pipeline query selects total_time', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/bb\.paid_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0 }] };
      return { rows: [] };
    });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getPipelineOverview({ query: {} }, res);
    const q = pool.query.mock.calls.find(([sql]) => /ORDER BY a\.service_date DESC/.test(sql))[0];
    expect(q).toMatch(/a\.total_time/);
  });

  test('so does every other query in the dashboard controller that feeds deriveEimsStatus', () => {
    const src = require('fs').readFileSync(require.resolve('../dashboardController'), 'utf8');
    const feeders = src.match(/SELECT a\.id, a\.billing_status, a\.eims_missing_status[^`]*`/g) || [];
    expect(feeders.length).toBeGreaterThanOrEqual(2);
    feeders.forEach((q) => expect(q).toMatch(/a\.total_time/));
  });
});
