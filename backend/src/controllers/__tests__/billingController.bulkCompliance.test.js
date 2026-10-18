jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/storage', () => ({
  BILLING_INVOICES_BUCKET: 'test-bucket',
  uploadFile: jest.fn().mockResolvedValue(),
  downloadFile: jest.fn(),
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/file'),
  removeFiles: jest.fn(),
  listFilesDetailed: jest.fn(),
}));
jest.mock('../../utils/invoiceGenerator', () => ({
  generateInvoicePDF: jest.fn().mockResolvedValue(Buffer.from('fake-invoice-pdf')),
}));
jest.mock('../../utils/njeisFormFiller', () => ({
  buildNjeisPdfForGroup: jest.fn().mockResolvedValue({
    getPageIndices: () => [0],
  }),
}));
jest.mock('../../utils/companyName', () => ({
  getCompanyName: jest.fn().mockResolvedValue('Test Agency'),
  getCompanySettingsForDocuments: jest.fn().mockResolvedValue({ legal_entity_name: 'Test Agency', address: '123 Main St' }),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(() => Buffer.from('fake-template')),
}));
jest.mock('pdf-lib', () => ({
  ...jest.requireActual('pdf-lib'),
  PDFDocument: {
    create: jest.fn().mockResolvedValue({
      copyPages: jest.fn().mockResolvedValue([{}]),
      addPage: jest.fn(),
      save: jest.fn().mockResolvedValue(Buffer.from('fake-sevf-pdf')),
    }),
  },
}));
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

describe('updateLogStatus duplicate gate', () => {
  afterEach(() => jest.clearAllMocks());

  test('rejects Approve when computeSessionCompliance reports a duplicate, even if flagged is false', async () => {
    jest.spyOn(require('../billingController'), 'computeSessionCompliance')
      .mockResolvedValue({ matched: true, flagged: false, documentOnFile: true, duplicateOfSessionId: 55, duplicateOfInvoiced: false });

    const req = { body: { assessmentId: 1, status: 'pending', review: 'accept' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const { updateLogStatus } = require('../billingController');
    await updateLogStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('duplicate'),
    }));
  });
});

describe('runAutoGenerateForPractitioner', () => {
  afterEach(() => jest.clearAllMocks());

  test('throws if no pending sessions exist in the period', async () => {
    const { runAutoGenerateForPractitioner } = require('../billingController');
    pool.query.mockResolvedValueOnce({ rows: [] }); // SEVF's own assessments query returns none
    await expect(runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7))
      .rejects.toThrow(/no pending/i);
  });

  test('full success returns batchId, sevfPath, and invoicePath all populated', async () => {
    const { runAutoGenerateForPractitioner } = require('../billingController');

    const fakeAssessment = {
      id: 1, patient_id: 10, service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
      total_time: 30, type: 'OT', location: '1', group_size_category: 'individual', billing_status: 'pending',
      patient_first_name: 'A', patient_last_name: 'B', patient_county: 'Essex',
      practitioner_discipline: 'OT',
      practitioners: { id: 42, first_name: 'C', last_name: 'D', pay_rate: '50', service_types: ['OT'], ssn: null },
      patients: { child_id: '700000001' },
    };

    pool.query
      .mockResolvedValueOnce({ rows: [fakeAssessment] }) // SEVF assessments query
      .mockResolvedValueOnce({ rows: [{ id: 'batch-uuid-1' }] }) // billing_batches INSERT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE assessments SET billing_batch_id
      .mockResolvedValueOnce({ rows: [] }) // UPDATE assessments SET billing_status = 'njeis_review'
      .mockResolvedValueOnce({ rows: [{ first_name: 'Sam', last_name: 'Specialist' }] }) // specialist name lookup
      .mockResolvedValueOnce({ rows: [] }); // UPDATE billing_batches SET invoice_path

    const result = await runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7);

    expect(result.success).toBe(true);
    expect(result.batchId).toBe('batch-uuid-1');
    expect(result.sevfPath).toEqual(expect.stringContaining('NJEIS_'));
    expect(result.invoicePath).toEqual(expect.stringContaining('Invoice_'));
  });
});

describe('bulkComplianceRun', () => {
  // restoreAllMocks (not clearAllMocks) — jest.spyOn(...).mockResolvedValue
  // in the first test below replaces acquireLock's implementation, and
  // clearAllMocks only resets call history, not that replaced
  // implementation, which otherwise leaks into every later test in this
  // file (confirmed: running the full suite together failed two tests
  // that pass individually, both showing the first test's lockedByName
  // bleeding through).
  afterEach(() => jest.restoreAllMocks());

  test('skips a practitioner already locked by another specialist', async () => {
    const billingController = require('../billingController');
    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: false, lockedByName: 'Jane Doe' });

    const req = { body: { practitionerIds: [42], startDate: '2026-10-01', endDate: '2026-10-15' }, practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    // Need practitioner name for the skippedLocked entry — mock the lookup query:
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42, first_name: 'Sam', last_name: 'Lee' }] });

    await billingController.bulkComplianceRun(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      skippedLocked: [expect.objectContaining({ practitionerId: 42, lockedByName: 'Jane Doe' })],
      autoGenerated: [],
      needsReview: [],
    }));
  });

  test('records a practitioner with zero pending sessions in the period as noSessions, never autoGenerated', async () => {
    const billingController = require('../billingController');
    const req = { body: { practitionerIds: [42], startDate: '2026-10-01', endDate: '2026-10-15' }, practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, first_name: 'Sam', last_name: 'Lee' }] }) // name lookup
      .mockResolvedValueOnce({ rows: [{ practitioner_id: 42 }] }) // acquireLock INSERT succeeds
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // pending-count query returns 0
      .mockResolvedValueOnce({ rows: [] }); // releaseLock DELETE

    await billingController.bulkComplianceRun(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      noSessions: [expect.objectContaining({ practitionerId: 42 })],
      autoGenerated: [],
    }));
  });

  test('practitionerIds:"all" with no pending logs anywhere returns all-empty arrays, not an error', async () => {
    const billingController = require('../billingController');
    const req = { body: { practitionerIds: 'all', startDate: '2026-10-01', endDate: '2026-10-15' }, practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    pool.query.mockResolvedValueOnce({ rows: [] }); // DISTINCT practitioner_id query returns none

    await billingController.bulkComplianceRun(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: true, autoGenerated: [], needsReview: [], skippedLocked: [], noSessions: [],
    });
  });

  test('one practitioner throwing during auto-generate does not stop the rest of the batch', async () => {
    const billingController = require('../billingController');
    const req = {
      body: { practitionerIds: [1, 2], startDate: '2026-10-01', endDate: '2026-10-15' },
      practitioner: { practitionerId: 7 },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    // Practitioner 1: clean, but runAutoGenerateForPractitioner throws (simulates invoice PDF failure).
    // Practitioner 2: clean, succeeds normally.
    jest.spyOn(billingController, 'runComplianceAnalysisForPractitioner').mockResolvedValue({
      documentOnFile: true, results: { 100: { matched: true, flagged: false } },
    });
    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: true });
    jest.spyOn(billingController, 'releaseLock').mockResolvedValue();
    jest.spyOn(billingController, 'runAutoGenerateForPractitioner')
      .mockRejectedValueOnce(new Error('GCS upload failed'))
      .mockResolvedValueOnce({ success: true, batchId: 'batch-2' });

    // Name lookups + pending-count checks for both practitioners:
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, first_name: 'A', last_name: 'One' }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, first_name: 'B', last_name: 'Two' }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    await billingController.bulkComplianceRun(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.autoGenerated).toEqual([expect.objectContaining({ practitionerId: 2 })]);
    expect(response.needsReview).toEqual([expect.objectContaining({ practitionerId: 1 })]);
  });
});
