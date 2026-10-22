// The EIMS match ring: which sessions count as matched, missing from EIMS,
// unverified, or flagged. "Missing" used to stay at 0 forever, because sessions
// the status logic labels Missing were lumped into "Mismatch / pending".
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceForLines: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn(),
  formatInvoiceNumber: (id) => `INV-${id}`,
}));

const { pool } = require('../../config/db');
const { deriveEimsStatus } = require('../../utils/invoiceData');
const { getPipelineOverview, eimsBucket } = require('../dashboardController');

beforeEach(() => {
  pool.query.mockReset();
  deriveEimsStatus.mockReset();
});

describe('eimsBucket', () => {
  test.each([
    [{ tier: 'cleared', label: 'Matched' }, false, 'matched'],
    [{ tier: 'cleared', label: 'Approved' }, false, 'matched'],
    [{ tier: 'cleared', label: 'Override' }, false, 'matched'],
    [{ tier: 'exception', label: 'Missing' }, false, 'missing'],
    [{ tier: 'pending', label: 'Awaiting' }, false, 'missing'], // missing, sent to an admin for approval
    [{ tier: 'unverified', label: 'Unverified' }, false, 'unverified'],
    [{ tier: 'pending', label: 'Mismatch' }, false, 'flagged'],
    [{ tier: 'exception', label: 'Duplicate' }, false, 'flagged'],
    [{ tier: 'exception', label: 'Rejected' }, false, 'flagged'],
    [{ tier: 'pending', label: 'Not entered' }, false, 'flagged'], // independent, not yet entered
    // A human hold/return/decline is flagged whatever EIMS says, even "Missing".
    [{ tier: 'exception', label: 'Missing' }, true, 'flagged'],
    [{ tier: 'cleared', label: 'Matched' }, true, 'flagged'],
  ])('%j (held=%s) -> %s', (derived, held, expected) => {
    expect(eimsBucket(derived, held)).toBe(expected);
  });
});

describe('getPipelineOverview EIMS ring', () => {
  test('counts missing sessions under missing, not under mismatch/pending', async () => {
    const billed = [
      { id: 1, billing_status: 'invoiced', practitioner_id: 1 },
      { id: 2, billing_status: 'invoiced', practitioner_id: 1 },
      { id: 3, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 4, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 5, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 6, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 7, billing_status: 'njeis_review', practitioner_id: 1 },
      { id: 8, billing_status: 'on_hold', practitioner_id: 1 },
    ];
    const byId = {
      1: { tier: 'cleared', label: 'Matched' },
      2: { tier: 'cleared', label: 'Approved' },
      3: { tier: 'exception', label: 'Missing' },
      4: { tier: 'pending', label: 'Awaiting' },
      5: { tier: 'unverified', label: 'Unverified' },
      6: { tier: 'pending', label: 'Mismatch' },
      7: { tier: 'exception', label: 'Duplicate' },
    };
    deriveEimsStatus.mockImplementation((s) => byId[s.id] || { tier: 'exception', label: 'Missing' });
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
      unverified: 1,
      flagged: 3, // Mismatch + Duplicate + the on-hold session
    });
  });
});
