process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/storage', () => ({
  NJEIS_FORMS_BUCKET: 'test-bucket',
  BILLING_INVOICES_BUCKET: 'test-bucket',
  uploadFile: jest.fn().mockResolvedValue(),
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/file'),
}));
jest.mock('../../utils/njeisGenerator', () => ({
  generateNjeisPDF: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');
const { getAuditLogs, getSessionAuditLog, getAllPatients, generateAuditNJEIS } = require('../reportController');

function mockReqRes(query = {}, body = {}) {
  const req = { query, body };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}

afterEach(() => jest.resetAllMocks());

describe('getAuditLogs name search against encrypted patient_first_name/last_name', () => {
  it('filters to only the matching child by decrypting rows after the date/status-scoped fetch', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), practitioners: {} },
        { id: 2, patient_first_name: encryptField('Omar'), patient_last_name: encryptField('Santos'), practitioners: {} },
      ],
    });
    const { req, res } = mockReqRes({ patientSearch: 'Luz' });
    await getAuditLogs(req, res);

    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].patient_first_name).toBe('Luz');
  });

  it('returns the full date/status-scoped set unfiltered when patientSearch is empty', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), practitioners: {} },
        { id: 2, patient_first_name: encryptField('Omar'), patient_last_name: encryptField('Santos'), practitioners: {} },
      ],
    });
    const { req, res } = mockReqRes({});
    await getAuditLogs(req, res);
    expect(res.body.logs).toHaveLength(2);

    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/patient_first_name ILIKE/i);
  });
});

describe('getSessionAuditLog name search against encrypted patient_first_name/last_name', () => {
  it('filters to only the matching child by decrypting rows after the date-scoped fetch', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), practitioners: {} },
        { id: 2, patient_first_name: encryptField('Omar'), patient_last_name: encryptField('Santos'), practitioners: {} },
      ],
    });
    const { req, res } = mockReqRes({ patientSearch: 'Quintero' });
    await getSessionAuditLog(req, res);

    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].patient_last_name).toBe('Quintero');
  });
});

describe('getAllPatients name search against encrypted first_name/last_name', () => {
  it('filters to only the matching child while still allowing child_id to match in SQL', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), child_id: 'CH-100', created_at: new Date() },
        { id: 2, first_name: encryptField('Omar'), last_name: encryptField('Santos'), child_id: 'CH-200', created_at: new Date() },
      ],
    });
    const { req, res } = mockReqRes({ patientSearch: 'Quintero' });
    await getAllPatients(req, res);

    expect(res.body.patients).toHaveLength(1);
    expect(res.body.patients[0].last_name).toBe('Quintero');
  });
});

describe('generateAuditNJEIS name search against encrypted patient_first_name/last_name', () => {
  it('filters to only the matching child before grouping into NJEIS forms', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ legal_entity_name: 'Test Agency' }] }) // getCompanyName
      .mockResolvedValueOnce({
        rows: [
          { id: 1, service_date: '2026-10-05', patient_id: 10, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), practitioner_id: 3, practitioners: { first_name: 'Omar', last_name: 'Abernathy', position_title: 'PT' } },
          { id: 2, service_date: '2026-10-06', patient_id: 20, patient_first_name: encryptField('Zoe'), patient_last_name: encryptField('Yang'), practitioner_id: 3, practitioners: { first_name: 'Omar', last_name: 'Abernathy', position_title: 'PT' } },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 20, first_name: encryptField('Zoe'), last_name: encryptField('Yang'), dob: encryptField('2024-01-01'), county: 'Essex', child_id: 'CH-200' }] }); // patient lookup for group 20
    const { req, res } = mockReqRes({}, { patientSearch: 'Yang' });
    await generateAuditNJEIS(req, res);
    // With 'Yang' filtering out the 'Luz Quintero' row, only one child
    // remains — if the match had failed (ciphertext never matching 'Yang'
    // via includes()), both rows would survive and this would reach the
    // patient-lookup query for BOTH groups, not just group 20 (Zoe Yang).
    const patientLookupCalls = pool.query.mock.calls.filter(([sql]) => /SELECT \* FROM patients WHERE id = \$1/.test(sql));
    expect(patientLookupCalls.map((c) => c[1][0])).toEqual([20]);

    const { generateNjeisPDF } = require('../../utils/njeisGenerator');
    expect(generateNjeisPDF).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ first_name: 'Zoe', last_name: 'Yang', dob: '2024-01-01' }),
      expect.anything(), expect.anything(), expect.anything()
    );
  });
});
