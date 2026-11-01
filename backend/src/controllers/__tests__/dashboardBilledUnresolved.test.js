// GET /api/dashboard/billed-unresolved — drill-down list for the EIMS
// donut's new "Billed, unresolved mismatch" category: already-billed
// sessions whose live EIMS evaluation is a genuine mismatch with nothing
// on file (no acknowledged/learned-override field) explaining why.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn(),
  formatInvoiceNumber: (id) => `INV-${id}`,
}));
jest.mock('../../utils/fieldEncryption', () => ({ decryptField: (v) => v }));

const { pool } = require('../../config/db');
const { deriveEimsStatus } = require('../../utils/invoiceData');
const { getBilledUnresolvedSessions } = require('../dashboardController');

beforeEach(() => {
  pool.query.mockReset();
  deriveEimsStatus.mockReset();
});

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

describe('getBilledUnresolvedSessions', () => {
  test('returns only billed sessions with a genuine mismatch and no override on file', async () => {
    const sessions = [
      { id: 1, billing_status: 'invoiced', practitioner_id: 1, total_time: 60, service_date: '2026-09-05',
        patient_first_name: 'Harper', patient_last_name: 'Keller', practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy' },
      { id: 2, billing_status: 'invoiced', practitioner_id: 1, total_time: 60, service_date: '2026-09-06',
        patient_first_name: 'Daniel', patient_last_name: 'Esposito', practitioner_first_name: 'Monica', practitioner_last_name: 'Whitaker' },
      { id: 3, billing_status: 'njeis_review', practitioner_id: 1, total_time: 60, service_date: '2026-09-07',
        patient_first_name: 'Felix', patient_last_name: 'Evans', practitioner_first_name: 'Rachel', practitioner_last_name: 'Banerjee' },
    ];
    deriveEimsStatus.mockImplementation((s) => {
      if (s.id === 1) return { tier: 'pending', label: 'Mismatch', hasOverride: false }; // billed, no override -> included
      if (s.id === 2) return { tier: 'pending', label: 'Mismatch', hasOverride: true }; // billed, has override -> excluded
      return { tier: 'pending', label: 'Mismatch', hasOverride: false }; // not yet billed -> excluded
    });

    pool.query.mockImplementation(async (sql) => {
      if (/billing_status IN \('njeis_review', 'invoiced'/.test(sql)) return { rows: sessions };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [{ id: 1, role: 'practitioner' }] };
      return { rows: [] };
    });

    const res = mkRes();
    await getBilledUnresolvedSessions({ query: { month: '2026-09' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const { sessions: out } = res.json.mock.calls[0][0];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 1, patientName: 'Harper Keller', practitionerName: 'Omar Abernathy',
      serviceDate: '2026-09-05', status: 'invoiced',
    });
  });

  test('an exceptionally-approved (is_override) session that still mismatches EIMS is included too', async () => {
    const sessions = [
      { id: 10, billing_status: 'invoiced', practitioner_id: 1, total_time: 60, service_date: '2026-09-10', is_override: true,
        patient_first_name: 'Arjun', patient_last_name: 'Rivera', practitioner_first_name: 'Hector', practitioner_last_name: 'Nguyen' },
      { id: 11, billing_status: 'invoiced', practitioner_id: 1, total_time: 60, service_date: '2026-09-11', is_override: true,
        patient_first_name: 'Layla', patient_last_name: 'James', practitioner_first_name: 'Hector', practitioner_last_name: 'Nguyen' },
    ];
    deriveEimsStatus.mockImplementation((s) => {
      // Overridden, but the underlying compliance data still disagrees ->
      // hasOverride: false (nothing actually resolved the discrepancy).
      // is_override always reports wasBypassed: true.
      if (s.id === 10) return { tier: 'cleared', label: 'Override', hasOverride: false, wasBypassed: true };
      // Overridden, but it turned out to actually match EIMS cleanly ->
      // hasOverride: true (genuinely resolved, not just bypassed).
      return { tier: 'cleared', label: 'Override', hasOverride: true, wasBypassed: true };
    });

    pool.query.mockImplementation(async (sql) => {
      if (/billing_status IN \('njeis_review', 'invoiced'/.test(sql)) return { rows: sessions };
      if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [{ id: 1, role: 'practitioner' }] };
      return { rows: [] };
    });

    const res = mkRes();
    await getBilledUnresolvedSessions({ query: { month: '2026-09' } }, res);

    const { sessions: out } = res.json.mock.calls[0][0];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 10, patientName: 'Arjun Rivera', practitionerName: 'Hector Nguyen' });
  });

  test('an empty result returns an empty list, not an error', async () => {
    deriveEimsStatus.mockReturnValue({ tier: 'cleared', label: 'Matched', hasOverride: false });
    pool.query.mockResolvedValue({ rows: [] });
    const res = mkRes();
    await getBilledUnresolvedSessions({ query: {} }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, sessions: [] });
  });

  test('?practitionerId= filters the underlying query', async () => {
    deriveEimsStatus.mockReturnValue({ tier: 'cleared', label: 'Matched', hasOverride: false });
    pool.query.mockResolvedValue({ rows: [] });
    const res = mkRes();
    await getBilledUnresolvedSessions({ query: { month: '2026-09', practitionerId: '4' } }, res);
    const [call] = pool.query.mock.calls.filter(([sql]) => /billing_status IN \('njeis_review', 'invoiced'/.test(sql));
    expect(call[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(call[1]).toContain(4);
  });
});
