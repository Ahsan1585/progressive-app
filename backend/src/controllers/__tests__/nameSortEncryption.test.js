process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/tenantContext', () => ({
  getCurrentTenantDb: jest.fn(() => 'test-tenant'),
}));
jest.mock('../../constants/dropdownOptionsCache', () => ({
  getDropdownOptionsCache: jest.fn(() => ({
    service_type: [{ code: 'PT', label: 'Physical Therapy', is_active: true }],
  })),
}));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');

function mockReqRes(query = {}, params = {}) {
  const req = { query, params, practitioner: { practitionerId: 1, slug: 'test' } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}
afterEach(() => jest.resetAllMocks());

describe('billingController patient-name sort against encrypted patient_first_name', () => {
  it('getPractitionerLogs returns rows sorted by patient_first_name then service_date despite SQL no longer ordering by name', async () => {
    const { getPractitionerLogs } = require('../billingController');
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, patient_first_name: encryptField('Zoe'), patient_last_name: encryptField('Yang'), service_date: '2026-10-01', billing_status: 'pending' },
        { id: 2, patient_first_name: encryptField('Amy'), patient_last_name: encryptField('Alpha'), service_date: '2026-10-02', billing_status: 'pending' },
      ],
    });
    const { req, res } = mockReqRes({ practitionerId: 1 });
    await getPractitionerLogs(req, res);
    expect(res.body.logs.map((l) => l.patient_first_name)).toEqual(['Amy', 'Zoe']);
  });

  it('getVaultLogs returns rows sorted by patient_first_name then service_date despite SQL no longer ordering by name', async () => {
    const { getVaultLogs } = require('../billingController');
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, patient_first_name: encryptField('Zoe'), patient_last_name: encryptField('Yang'), service_date: '2026-10-01' },
        { id: 2, patient_first_name: encryptField('Amy'), patient_last_name: encryptField('Alpha'), service_date: '2026-10-02' },
      ],
    });
    const { req, res } = mockReqRes({ practitionerFolder: 'Omar_Abernathy', batchId: 'b1' });
    await getVaultLogs(req, res);
    expect(res.body.logs.map((l) => l.patient_first_name)).toEqual(['Amy', 'Zoe']);
  });
});

describe('patientDirectoryController.listDirectoryPatients decrypts child identity without changing practitioner sort', () => {
  it('returns decrypted first_name/middle_name/last_name/dob while the practitioners sub-array order is untouched', async () => {
    const { listDirectoryPatients } = require('../patientDirectoryController');
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        first_name: encryptField('Luz'), middle_name: encryptField('Marie'), last_name: encryptField('Quintero'), dob: encryptField('2024-03-05'),
        county: 'Essex', child_id: 'CH-100', created_at: new Date(), parent_name: 'Ana Quintero', parent_email: 'ana@example.com',
        practitioners: [{ id: 3, first_name: 'Omar', last_name: 'Abernathy', status: 'active', position_title: 'PT' }],
      }],
    });
    const { req, res } = mockReqRes();
    await listDirectoryPatients(req, res);
    const child = res.body.patients[0];
    expect(child.first_name).toBe('Luz');
    expect(child.last_name).toBe('Quintero');
    expect(child.dob).toBe('2024-03-05');
    expect(child.practitioners[0].first_name).toBe('Omar');
  });
});

describe('patientRecordExportController decrypts patient rows before building the Record of Access PDF', () => {
  it('generateSingleChildInvoice decrypts the patient lookup and the assessment rows feeding the invoice', async () => {
    jest.mock('../../utils/invoiceGenerator', () => ({ generateInvoicePDF: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')) }));
    jest.spyOn(require('../billingController'), 'computeSessionCompliance').mockResolvedValue({ matched: true, flagged: false, fields: [] });
    const { generateSingleChildInvoice } = require('../patientRecordExportController');
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero') }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1, patient_id: 5, practitioner_id: 3,
          patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), patient_dob: encryptField('2024-03-05'),
          billing_status: 'invoiced', total_time: 60, service_date: '2026-10-01',
          practitioners: { id: 3, first_name: 'Omar', last_name: 'Abernathy', position_title: 'PT', ssn: null, service_types: [] },
          patients: { first_name: encryptField('Luz'), last_name: encryptField('Quintero') },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ display_name: 'Test Agency', legal_entity_name: 'Test Agency' }] }); // getCompanySettingsForDocuments
    const req = { params: { id: '5' }, practitioner: { email: 'office@x.com' } };
    const res = {
      statusCode: 200, body: null, headers: {},
      status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
      setHeader() {}, send() {},
    };
    await generateSingleChildInvoice(req, res);
    expect(res.statusCode).not.toBe(404);
  });
});

describe('dashboardController decrypts patient_first_name/patient_last_name read directly from assessments', () => {
  it('returns decrypted names in the exceptions/flagged-sessions list', async () => {
    const { getDayOverview } = require('../dashboardController');
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: 0, practitioners: 0 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1, billing_status: 'on_hold', service_date: '2026-10-01', hold_note: 'note', rejection_note: null,
          flagged_at: new Date(), patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
          practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy', total_time: 60, pay_rate: 40,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes();
    await getDayOverview(req, res);
    expect(res.body.flaggedSessions[0].patientName).toBe('Luz Quintero');
  });
});

describe('display-only consumers decrypt without needing any sort/filter change', () => {
  it('inspectionRequestController returns decrypted patient_first_name/patient_last_name', async () => {
    const { listInspectionRequests } = require('../inspectionRequestController');
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, patient_id: 5, requested_by_name: 'Rosa', requested_by_relationship: 'parent',
        requested_at: '2026-10-01', received_by: 3, identity_verified_method: 'known_parent', identity_verified_note: null,
        due_at: '2026-10-11', status: 'open', fulfilled_at: null, fulfilled_by: null, fulfillment_note: null, created_at: new Date(),
        patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
      }],
    });
    const { req, res } = mockReqRes();
    await listInspectionRequests(req, res);
    expect(res.body.requests[0].patient_first_name).toBe('Luz');
    expect(res.body.requests[0].patient_last_name).toBe('Quintero');
  });

  it('practitionerDashboardController returns decrypted patient_first_name/patient_last_name', async () => {
    const { getAgencySummary } = require('../practitionerDashboardController');
    pool.query
      .mockResolvedValueOnce({ rows: [{ pay_rate: 40 }] }) // getPayRate
      .mockResolvedValueOnce({
      rows: [{
        id: 1, service_date: '2026-10-01', total_time: 60, billing_status: 'invoiced', billing_review: null,
        eims_missing_status: null, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
        rejection_note: null, rejected_at: null, hold_note: null, held_at: null, paid_at: null,
      }],
    });
    const { req, res } = mockReqRes({ month: '2026-10' });
    await getAgencySummary(req, res);
    expect(res.statusCode).not.toBe(500);
  });

  it('scheduleController returns decrypted patient_first_name/patient_last_name', async () => {
    const { listSessions } = require('../scheduleController');
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, patient_id: 5, session_date: '2026-10-01', start_time: '10:00', end_time: '11:00', location: '1',
        patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
      }],
    });
    const { req, res } = mockReqRes();
    await listSessions(req, res);
    expect(res.body[0].patient_first_name).toBe('Luz');
    expect(res.body[0].patient_last_name).toBe('Quintero');
  });

  it('sessionDraftsController.listDrafts returns decrypted patient_first_name/patient_last_name', async () => {
    const { listDrafts } = require('../sessionDraftsController');
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // the 30-day cleanup DELETE
      .mockResolvedValueOnce({
        rows: [{
          id: 1, patient_id: 5, updated_at: new Date(),
          patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
          form_data: {}, parent_signature: null, practitioner_signature: null,
        }],
      });
    const { req, res } = mockReqRes();
    res.set = () => {};
    await listDrafts(req, res);
    expect(res.body.drafts[0].patient_first_name).toBe('Luz');
    expect(res.body.drafts[0].patient_last_name).toBe('Quintero');
  });
});
