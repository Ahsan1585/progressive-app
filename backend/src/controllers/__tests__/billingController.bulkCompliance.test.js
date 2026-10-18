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
// Real option set only for service_status — lets the service_status field
// comparison test below exercise genuine match/mismatch via
// mapStatusLabelToCode/statusCodeLabel instead of the universal null that
// an empty cache would produce for every category.
jest.mock('../../constants/dropdownOptionsCache', () => ({
  getDropdownOptionsCache: jest.fn(() => ({
    service_status: [
      { code: 'done', label: 'Service Delivered', is_active: true },
      { code: 'cancelled', label: 'Cancelled', is_active: true },
    ],
  })),
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

  // service_status replaced logged_date as a built-in mapped/compared field
  // (same tier as Service/Location/Group Size) — when mapped, a session
  // whose status agrees with the state's Service Status column is clean...
  test('service_status field matches when mapped and the state label agrees with our status', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{
        compliance_doc_filename: 'eims.xlsx', compliance_doc_uploaded_at: new Date(),
        compliance_doc_column_mapping: { child_id: 'Child ID', service_date: 'Service Date', service_status_label: 'Service Status' },
        compliance_doc_path: 'p1', compliance_doc_applied_path: 'p1',
        compliance_doc_custom_fields: [], compliance_strictness: 'moderate',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 1, patient_id: 10, service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
        total_time: 30, type: 'OT', location: '1', group_size_category: 'individual',
        patient_first_name: 'A', patient_last_name: 'B', practitioner_first_name: 'C', practitioner_last_name: 'D',
        completed_at: new Date(), child_id: '700000001', status: 'done', billing_status: 'pending',
        practitioner_discipline: 'OT', patient_dob: '2024-01-01', patient_county: 'Essex',
        eims_missing_status: null, form_data: {},
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 900, patient_id: 10, child_id: '700000001', child_name: 'A B', practitioner_name: 'C D',
        service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
        ifsp_event_id: null, service_label: 'OT', location_label: 'Home', group_size_label: 'Direct Child Service - Individual',
        service_status_label: 'Service Delivered',
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await runComplianceAnalysisForPractitioner(42, '2026-10-01', '2026-10-15');
    const statusField = result.results[1].fields.find((f) => f.key === 'service_status');
    expect(statusField.match).toBe(true);
    expect(result.results[1].flagged).toBe(false);
  });

  // ...and is flagged when the state's Service Status disagrees.
  test('service_status field flags when mapped and the state label disagrees with our status', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{
        compliance_doc_filename: 'eims.xlsx', compliance_doc_uploaded_at: new Date(),
        compliance_doc_column_mapping: { child_id: 'Child ID', service_date: 'Service Date', service_status_label: 'Service Status' },
        compliance_doc_path: 'p1', compliance_doc_applied_path: 'p1',
        compliance_doc_custom_fields: [], compliance_strictness: 'moderate',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 1, patient_id: 10, service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
        total_time: 30, type: 'OT', location: '1', group_size_category: 'individual',
        patient_first_name: 'A', patient_last_name: 'B', practitioner_first_name: 'C', practitioner_last_name: 'D',
        completed_at: new Date(), child_id: '700000001', status: 'done', billing_status: 'pending',
        practitioner_discipline: 'OT', patient_dob: '2024-01-01', patient_county: 'Essex',
        eims_missing_status: null, form_data: {},
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 900, patient_id: 10, child_id: '700000001', child_name: 'A B', practitioner_name: 'C D',
        service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
        ifsp_event_id: null, service_label: 'OT', location_label: 'Home', group_size_label: 'Direct Child Service - Individual',
        service_status_label: 'Cancelled',
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await runComplianceAnalysisForPractitioner(42, '2026-10-01', '2026-10-15');
    const statusField = result.results[1].fields.find((f) => f.key === 'service_status');
    expect(statusField.match).toBe(false);
    expect(result.results[1].flagged).toBe(true);
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

  // Regression test for a Critical finding from the whole-branch review:
  // runAutoGenerateForPractitioner originally re-queried billing_status=
  // 'pending' sessions independently of whatever the caller's compliance
  // check had validated, so a session that became pending in the gap
  // between the check and this call (a new log submitted, a Returned log
  // resubmitted, a Hold released) could get billed without ever being
  // checked against EIMS. It now REQUIRES the exact validated id set and
  // refuses to run without it.
  test('throws if called without the validated assessment ids (refuses to derive its own session set)', async () => {
    const { runAutoGenerateForPractitioner } = require('../billingController');
    await expect(runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7, []))
      .rejects.toThrow(/validated assessment ids/i);
    await expect(runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7, undefined))
      .rejects.toThrow(/validated assessment ids/i);
  });

  test('throws if none of the validated ids are still pending', async () => {
    const { runAutoGenerateForPractitioner } = require('../billingController');
    pool.query.mockResolvedValueOnce({ rows: [] }); // SEVF query, scoped to id=ANY([1]) AND status='pending', finds nothing
    await expect(runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7, [1]))
      .rejects.toThrow(/no pending/i);
  });

  // Regression test: if the validated set was 2 sessions but only 1 is
  // still actually pending by the time this runs (the other's status
  // changed in the gap), the old code would have silently billed just
  // the 1 that matched — this must refuse instead, since "this
  // practitioner's period is entirely clean" is no longer a true
  // statement about what's about to be billed.
  test('throws if the pending session count no longer matches the validated set (mid-run drift)', async () => {
    const { runAutoGenerateForPractitioner } = require('../billingController');
    const fakeAssessment = {
      id: 1, patient_id: 10, service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
      total_time: 30, type: 'OT', location: '1', group_size_category: 'individual', billing_status: 'pending',
      patient_first_name: 'A', patient_last_name: 'B', patient_county: 'Essex',
      practitioner_discipline: 'OT',
      practitioners: { id: 42, first_name: 'C', last_name: 'D', pay_rate: '50', service_types: ['OT'], ssn: null },
      patients: { child_id: '700000001' },
    };
    // Validated set was [1, 2], but the re-check query (scoped to those
    // ids AND billing_status='pending') only finds id 1 still pending —
    // id 2 must have changed status in the gap.
    pool.query.mockResolvedValueOnce({ rows: [fakeAssessment] });
    await expect(runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7, [1, 2]))
      .rejects.toThrow(/session set changed/i);
  });

  test('full success returns batchId, sevfPath, and invoicePath all populated, billing exactly the validated ids', async () => {
    const { runAutoGenerateForPractitioner } = require('../billingController');

    const fakeAssessment = {
      id: 1, patient_id: 10, service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
      total_time: 30, type: 'OT', location: '1', group_size_category: 'individual', billing_status: 'pending',
      patient_first_name: 'A', patient_last_name: 'B', patient_county: 'Essex',
      practitioner_discipline: 'OT',
      practitioners: { id: 42, first_name: 'C', last_name: 'D', pay_rate: '50', service_types: ['OT'], ssn: null },
      patients: { child_id: '700000001' },
    };

    // This test runs runAutoGenerateForPractitioner through its ENTIRE
    // real flow (SEVF, batch bookkeeping, invoice, auto-complete), which
    // also fires logAudit's own fire-and-forget pool.query INSERTs and
    // calls getCompanyName/getCompanySettingsForDocuments — a positional
    // mockResolvedValueOnce chain is too brittle against that real call
    // count/order (confirmed empirically: it's 10 real pool.query calls,
    // not the 6-8 a naive reading of the source suggests). Dispatching by
    // matching each SQL statement's own text is robust to that — it
    // doesn't care how many calls happen or in what order, only what each
    // one actually is.
    pool.query.mockImplementation((sql) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT a.*, to_jsonb(p) AS practitioners')) return Promise.resolve({ rows: [fakeAssessment] });
      if (s.startsWith('INSERT INTO billing_batches')) return Promise.resolve({ rows: [{ id: 'batch-uuid-1' }] });
      if (s.startsWith("UPDATE assessments SET billing_status = 'njeis_review'")) return Promise.resolve({ rows: [{ id: 1 }] });
      if (s.startsWith("UPDATE assessments SET billing_status = 'invoiced'")) return Promise.resolve({ rows: [{ id: 1 }] });
      if (s.startsWith('SELECT first_name, last_name FROM practitioners')) return Promise.resolve({ rows: [{ first_name: 'Sam', last_name: 'Specialist' }] });
      // Everything else (billing_batch_id UPDATE, invoice_path UPDATE,
      // audit_logs INSERTs, company_settings/compliance lookups inside
      // getCompanyName/getCompanySettingsForDocuments/computeSessionCompliance)
      // is irrelevant to this test's assertions — an empty row set lets
      // each of those degrade/no-op exactly as it would on a real tenant
      // with no data, without this test needing to track its position.
      return Promise.resolve({ rows: [] });
    });

    const result = await runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7, [1]);

    expect(result.success).toBe(true);
    expect(result.batchId).toBe('batch-uuid-1');
    expect(result.sevfPath).toEqual(expect.stringContaining('NJEIS_'));
    expect(result.invoicePath).toEqual(expect.stringContaining('Invoice_'));
    expect(result.completedCount).toBe(1);

    // Confirm the SEVF query was scoped to the validated ids, not a bare
    // billing_status='pending' re-derivation.
    const sevfCall = pool.query.mock.calls.find(([sql]) => sql.includes('to_jsonb(p) AS practitioners'));
    expect(sevfCall[1]).toEqual([42, [1], 'pending']);

    // Confirm the final auto-complete UPDATE actually ran, scoped to the
    // same validated id set.
    const completeCall = pool.query.mock.calls.find(([sql]) => sql.includes("billing_status = 'invoiced'"));
    expect(completeCall[1]).toEqual([[1]]);
  });

  test('throws (without silently advancing a partial set) if the njeis_review UPDATE affects fewer rows than validated', async () => {
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
      .mockResolvedValueOnce({ rows: [] }) // UPDATE billing_batch_id
      .mockResolvedValueOnce({ rows: [] }); // UPDATE billing_status='njeis_review' RETURNING id — returns ZERO rows, a race was detected here

    await expect(runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7, [1]))
      .rejects.toThrow(/concurrent change was detected/i);
  });

  // A clean period auto-generates AND auto-completes in one call (per
  // explicit user request: "send to completed should have also happened
  // automatically") — this proves the final invoiced-status UPDATE
  // actually runs and is itself guarded the same way every other status
  // transition in this function is (throws rather than silently
  // completing a partial set if something changed mid-flight).
  test('throws if the final invoiced-status UPDATE affects fewer rows than expected', async () => {
    const { runAutoGenerateForPractitioner } = require('../billingController');
    const fakeAssessment = {
      id: 1, patient_id: 10, service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
      total_time: 30, type: 'OT', location: '1', group_size_category: 'individual', billing_status: 'pending',
      patient_first_name: 'A', patient_last_name: 'B', patient_county: 'Essex',
      practitioner_discipline: 'OT',
      practitioners: { id: 42, first_name: 'C', last_name: 'D', pay_rate: '50', service_types: ['OT'], ssn: null },
      patients: { child_id: '700000001' },
    };
    // Same content-matching approach as the full-success test above — this
    // test must also run the whole function up to the final guard, so a
    // positional mock chain is equally brittle here.
    pool.query.mockImplementation((sql) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT a.*, to_jsonb(p) AS practitioners')) return Promise.resolve({ rows: [fakeAssessment] });
      if (s.startsWith('INSERT INTO billing_batches')) return Promise.resolve({ rows: [{ id: 'batch-uuid-1' }] });
      if (s.startsWith("UPDATE assessments SET billing_status = 'njeis_review'")) return Promise.resolve({ rows: [{ id: 1 }] });
      // The one query this test deliberately makes return fewer rows than
      // expected, to trigger the final guard.
      if (s.startsWith("UPDATE assessments SET billing_status = 'invoiced'")) return Promise.resolve({ rows: [] });
      if (s.startsWith('SELECT first_name, last_name FROM practitioners')) return Promise.resolve({ rows: [{ first_name: 'Sam', last_name: 'Specialist' }] });
      return Promise.resolve({ rows: [] });
    });

    await expect(runAutoGenerateForPractitioner(42, '2026-10-01', '2026-10-15', 7, [1]))
      .rejects.toThrow(/could be moved to Completed Bills/i);
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
      .mockResolvedValueOnce({ rows: [] }) // pending-ids query returns no rows
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
    // Practitioner 2: clean, succeeds normally. Both practitioners' sole
    // pending session has id 100 (mirrored in the pendingIds query below),
    // so pendingResults lines up with the mocked compliance analysis result.
    jest.spyOn(billingController, 'runComplianceAnalysisForPractitioner').mockResolvedValue({
      documentOnFile: true, results: { 100: { matched: true, flagged: false } },
    });
    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: true });
    jest.spyOn(billingController, 'releaseLock').mockResolvedValue();
    jest.spyOn(billingController, 'runAutoGenerateForPractitioner')
      .mockRejectedValueOnce(new Error('GCS upload failed'))
      .mockResolvedValueOnce({ success: true, batchId: 'batch-2' });

    // Name lookups + pending-ids queries for both practitioners:
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, first_name: 'A', last_name: 'One' }] })
      .mockResolvedValueOnce({ rows: [{ id: 100 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, first_name: 'B', last_name: 'Two' }] })
      .mockResolvedValueOnce({ rows: [{ id: 100 }] });

    await billingController.bulkComplianceRun(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.autoGenerated).toEqual([expect.objectContaining({ practitionerId: 2 })]);
    expect(response.needsReview).toEqual([expect.objectContaining({ practitionerId: 1 })]);
  });

  // Regression test for a Critical finding: releaseLock used to run
  // unconditionally in the per-practitioner finally block, including when
  // acquireLock reported alreadyMine:true (the caller already held this
  // lock before the bulk run started — e.g. a manual review in progress).
  // That silently deleted the caller's own pre-existing lock the moment
  // this run finished with that practitioner. releaseLock must only be
  // called when this run itself acquired a fresh lock.
  test('does not release a lock the caller already held before the run (alreadyMine)', async () => {
    const billingController = require('../billingController');
    const req = { body: { practitionerIds: [42], startDate: '2026-10-01', endDate: '2026-10-15' }, practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: true, alreadyMine: true });
    const releaseLockSpy = jest.spyOn(billingController, 'releaseLock').mockResolvedValue();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, first_name: 'Sam', last_name: 'Lee' }] }) // name lookup
      .mockResolvedValueOnce({ rows: [] }); // pending-ids query returns no rows -> noSessions, early continue

    await billingController.bulkComplianceRun(req, res);

    expect(releaseLockSpy).not.toHaveBeenCalled();
  });

  // A practitioner the caller already has locked (e.g. a manual review they
  // started earlier) must still be analyzed by the bulk run, not skipped —
  // only a lock held by a DIFFERENT specialist should cause a skip.
  test('still runs analysis against a practitioner the caller already has locked', async () => {
    const billingController = require('../billingController');
    const req = { body: { practitionerIds: [42], startDate: '2026-10-01', endDate: '2026-10-15' }, practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: true, alreadyMine: true });
    const releaseLockSpy = jest.spyOn(billingController, 'releaseLock').mockResolvedValue();
    jest.spyOn(billingController, 'runComplianceAnalysisForPractitioner').mockResolvedValue({
      documentOnFile: true, results: { 100: { matched: true, flagged: false } },
    });
    jest.spyOn(billingController, 'runAutoGenerateForPractitioner').mockResolvedValue({
      success: true, batchId: 'batch-42', completedCount: 1,
    });

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, first_name: 'Sam', last_name: 'Lee' }] }) // name lookup
      .mockResolvedValueOnce({ rows: [{ id: 100 }] }); // pending-ids query

    await billingController.bulkComplianceRun(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.autoGenerated).toEqual([expect.objectContaining({ practitionerId: 42, batchId: 'batch-42' })]);
    expect(response.skippedLocked).toEqual([]);
    expect(releaseLockSpy).not.toHaveBeenCalled();
  });

  // Regression test for an Important finding: a bad/stale practitioner id
  // (or any DB error on one practitioner) used to be outside the
  // per-practitioner try/catch for the name lookup and lock acquire,
  // aborting the whole request with a 500 and discarding every result
  // already accumulated for practitioners processed earlier in the loop.
  test('one practitioner whose name lookup throws does not abort the rest of the batch', async () => {
    const billingController = require('../billingController');
    const req = {
      body: { practitionerIds: [1, 2], startDate: '2026-10-01', endDate: '2026-10-15' },
      practitioner: { practitionerId: 7 },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: true });
    jest.spyOn(billingController, 'releaseLock').mockResolvedValue();

    pool.query
      .mockRejectedValueOnce(new Error('connection reset')) // practitioner 1's name lookup throws
      .mockResolvedValueOnce({ rows: [{ id: 2, first_name: 'B', last_name: 'Two' }] }) // practitioner 2's name lookup
      .mockResolvedValueOnce({ rows: [] }); // practitioner 2's pending-ids query -> noSessions

    await billingController.bulkComplianceRun(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const response = res.json.mock.calls[0][0];
    expect(response.needsReview).toEqual([expect.objectContaining({ practitionerId: 1 })]);
    expect(response.noSessions).toEqual([expect.objectContaining({ practitionerId: 2 })]);
  });

  // Regression test for an Important finding: isClean originally checked
  // EVERY session in analysis.results (the whole period), not just the
  // pending ones generation will actually bill. A matched-but-on_hold
  // session in the same period could never satisfy "entire period clean"
  // under the old check even though it isn't part of what's being billed
  // at all — this confirms a held session in the same period no longer
  // blocks auto-generation of the practitioner's actual pending work.
  test('a held (non-pending) session in the same period does not block auto-generation of pending work', async () => {
    const billingController = require('../billingController');
    const req = { body: { practitionerIds: [42], startDate: '2026-10-01', endDate: '2026-10-15' }, practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: true });
    jest.spyOn(billingController, 'releaseLock').mockResolvedValue();
    // The period's compliance analysis includes BOTH the pending session
    // (id 100, clean) and an on_hold session (id 200, flagged) — only the
    // pending one is relevant to this practitioner's auto-generate check.
    jest.spyOn(billingController, 'runComplianceAnalysisForPractitioner').mockResolvedValue({
      documentOnFile: true,
      results: {
        100: { matched: true, flagged: false },
        200: { matched: false, flagged: true },
      },
    });
    jest.spyOn(billingController, 'runAutoGenerateForPractitioner').mockResolvedValue({ success: true, batchId: 'batch-1' });

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, first_name: 'Sam', last_name: 'Lee' }] }) // name lookup
      .mockResolvedValueOnce({ rows: [{ id: 100 }] }); // pending-ids query — only the pending session, not the held one

    await billingController.bulkComplianceRun(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.autoGenerated).toEqual([expect.objectContaining({ practitionerId: 42, batchId: 'batch-1' })]);
    expect(response.needsReview).toEqual([]);
  });

  // needsReview entries must say WHY, so the specialist knows what to do
  // next instead of just "needs review" — a mixed clean/flagged period
  // leaves every pending session untouched (all-or-nothing per practitioner),
  // so the message must say that explicitly rather than implying only the
  // flagged ones were held back.
  test('needsReview reason explains a mixed clean/flagged period left everything pending', async () => {
    const billingController = require('../billingController');
    const req = { body: { practitionerIds: [42], startDate: '2026-10-01', endDate: '2026-10-15' }, practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: true });
    jest.spyOn(billingController, 'releaseLock').mockResolvedValue();
    jest.spyOn(billingController, 'runComplianceAnalysisForPractitioner').mockResolvedValue({
      documentOnFile: true,
      results: {
        100: { matched: true, flagged: false },
        101: { matched: false, flagged: true },
      },
    });

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, first_name: 'Sam', last_name: 'Lee' }] }) // name lookup
      .mockResolvedValueOnce({ rows: [{ id: 100 }, { id: 101 }] }); // pending-ids query

    await billingController.bulkComplianceRun(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.needsReview).toEqual([
      expect.objectContaining({
        practitionerId: 42,
        reason: expect.stringContaining('1 of 2 sessions'),
      }),
    ]);
    expect(response.needsReview[0].reason).toContain('stayed pending');
  });

  // No document on file at all gets a distinct, specific reason rather
  // than being lumped in with "some sessions didn't clear."
  test('needsReview reason calls out a missing EIMS reference document specifically', async () => {
    const billingController = require('../billingController');
    const req = { body: { practitionerIds: [42], startDate: '2026-10-01', endDate: '2026-10-15' }, practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    jest.spyOn(billingController, 'acquireLock').mockResolvedValue({ acquired: true });
    jest.spyOn(billingController, 'releaseLock').mockResolvedValue();
    jest.spyOn(billingController, 'runComplianceAnalysisForPractitioner').mockResolvedValue({
      documentOnFile: false,
      results: {},
    });

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, first_name: 'Sam', last_name: 'Lee' }] })
      .mockResolvedValueOnce({ rows: [{ id: 100 }] });

    await billingController.bulkComplianceRun(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.needsReview).toEqual([
      expect.objectContaining({
        practitionerId: 42,
        reason: expect.stringContaining('No EIMS compliance reference document'),
      }),
    ]);
  });
});
