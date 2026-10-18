jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
// buildFieldsForSession resolves service/location/group-size labels through
// the tenant-scoped dropdown cache (njeis.js's codeLabel ->
// getDropdownOptionsCache -> getCurrentTenantDb) — outside any real request's
// AsyncLocalStorage context, that throws "No tenant context set". A stand-in
// tenant name is enough: the cache then just misses and falls back to the
// raw code, which these tests don't assert against.
jest.mock('../../config/tenantContext', () => ({
  getCurrentTenantDb: jest.fn(() => 'test-tenant'),
}));
const { pool } = require('../../config/db');

const { runComplianceAnalysisForPractitioner } = require('../billingController');

describe('runComplianceAnalysisForPractitioner', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns documentOnFile:false and empty results when no compliance doc is confirmed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ compliance_doc_filename: null }] }) // company_settings
      .mockResolvedValueOnce({ rows: [] }); // sessions query always runs before the documentOnFile check
    const result = await runComplianceAnalysisForPractitioner(42, '2026-10-01', '2026-10-15');
    expect(result.documentOnFile).toBe(false);
    expect(result.results).toEqual({});
  });

  test('returns matched:true for a session whose state row lines up on every mapped field', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ // company_settings
        compliance_doc_filename: 'eims.xlsx', compliance_doc_uploaded_at: new Date(),
        compliance_doc_column_mapping: { child_id: 'Child ID', service_date: 'Service Date' },
        compliance_doc_path: 'p1', compliance_doc_applied_path: 'p1',
        compliance_doc_custom_fields: [], compliance_strictness: 'moderate',
      }] })
      .mockResolvedValueOnce({ rows: [{ // sessions
        id: 1, patient_id: 10, service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
        total_time: 30, type: 'OT', location: '1', group_size_category: 'individual',
        patient_first_name: 'A', patient_last_name: 'B', practitioner_first_name: 'C', practitioner_last_name: 'D',
        completed_at: new Date(), child_id: '700000001', status: 'done', billing_status: 'pending',
        practitioner_discipline: 'OT', patient_dob: '2024-01-01', patient_county: 'Essex',
        eims_missing_status: null, form_data: {},
      }] })
      .mockResolvedValueOnce({ rows: [] }) // unlinked state-log backfill (empty, skips the UPDATE/INSERT loop)
      .mockResolvedValueOnce({ rows: [{ // raw state logs for this patient
        id: 900, patient_id: 10, child_id: '700000001', child_name: 'A B', practitioner_name: 'C D',
        service_date: '2026-10-05', start_time: '09:00', end_time: '09:30', logged_date: '2026-10-05',
        ifsp_event_id: null, service_label: 'OT', location_label: 'Home', group_size_label: 'Direct Child Service - Individual',
      }] })
      .mockResolvedValueOnce({ rows: [] }) // loadOverridesByField
      .mockResolvedValueOnce({ rows: [] }) // loadAcknowledgments
      .mockResolvedValueOnce({ rows: [] }); // historical-invoiced duplicate lookup (stillUnresolved.length > 0)

    const result = await runComplianceAnalysisForPractitioner(42, '2026-10-01', '2026-10-15');
    expect(result.documentOnFile).toBe(true);
    expect(result.results[1].matched).toBe(true);
    expect(result.results[1].flagged).toBe(false);
  });
});

describe('acquireLock / releaseLock', () => {
  afterEach(() => jest.clearAllMocks());

  test('acquireLock returns acquired:true on a fresh lock', async () => {
    const { acquireLock } = require('../billingController');
    pool.query.mockResolvedValueOnce({ rows: [{ practitioner_id: 42 }] }); // INSERT ... ON CONFLICT DO NOTHING RETURNING
    const result = await acquireLock(42, 7, 'review');
    expect(result.acquired).toBe(true);
  });

  test('acquireLock returns acquired:false with the holder name when held by someone else', async () => {
    const { acquireLock } = require('../billingController');
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // INSERT did nothing (conflict)
      .mockResolvedValueOnce({ rows: [{ locked_by: 99, first_name: 'Jane', last_name: 'Doe' }] }); // who holds it
    const result = await acquireLock(42, 7, 'review');
    expect(result.acquired).toBe(false);
    expect(result.lockedByName).toBe('Jane Doe');
  });
});
