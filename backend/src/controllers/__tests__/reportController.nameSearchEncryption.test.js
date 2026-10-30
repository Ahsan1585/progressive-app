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
  it('filters to only the matching child by scoping SQL by patient_id BEFORE the LIMIT, not after', async () => {
    pool.query
      .mockResolvedValueOnce({ // resolvePatientIdsByName's own patients scan
        rows: [
          { id: 10, first_name: encryptField('Luz'), last_name: encryptField('Quintero') },
          { id: 20, first_name: encryptField('Omar'), last_name: encryptField('Santos') },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, patient_id: 10, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), practitioners: {} },
        ],
      });
    const { req, res } = mockReqRes({ patientSearch: 'Luz' });
    await getAuditLogs(req, res);

    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].patient_first_name).toBe('Luz');
    // The second query (the real audit-logs fetch) must scope by the
    // resolved patient_id list, not rely on a post-fetch Node filter that
    // would silently drop matches once the date/status-scoped set exceeds
    // the 1000-row LIMIT.
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/a\.patient_id = ANY/);
    expect(params[params.length - 1]).toEqual([10]);
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
  it('filters to only the matching child by scoping SQL by patient_id BEFORE the LIMIT', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { id: 10, first_name: encryptField('Luz'), last_name: encryptField('Quintero') },
          { id: 20, first_name: encryptField('Omar'), last_name: encryptField('Santos') },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, patient_id: 10, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), practitioners: {} },
        ],
      });
    const { req, res } = mockReqRes({ patientSearch: 'Quintero' });
    await getSessionAuditLog(req, res);

    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].patient_last_name).toBe('Quintero');
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/a\.patient_id = ANY/);
    expect(params[params.length - 1]).toEqual([10]);
  });
});

describe('getAllPatients name search against encrypted first_name/last_name', () => {
  it('filters to the matching child by NAME, not just by child_id (review finding I1)', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), child_id: 'CH-100', created_at: new Date() },
        { id: 2, first_name: encryptField('Omar'), last_name: encryptField('Santos'), child_id: 'CH-200', created_at: new Date() },
      ],
    });
    const { req, res } = mockReqRes({ patientSearch: 'Quintero' });
    await getAllPatients(req, res);

    // Searching a name that does NOT appear in any child_id must still
    // match — the SQL child_id ILIKE filter (dropped by this fix) used to
    // narrow the candidate set to zero before the Node name filter ever ran.
    expect(res.body.patients).toHaveLength(1);
    expect(res.body.patients[0].last_name).toBe('Quintero');

    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/child_id ILIKE/i);
  });

  it('still matches by child_id when the search term is not a name', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), child_id: 'CH-100', created_at: new Date() },
        { id: 2, first_name: encryptField('Omar'), last_name: encryptField('Santos'), child_id: 'CH-200', created_at: new Date() },
      ],
    });
    const { req, res } = mockReqRes({ patientSearch: 'CH-200' });
    await getAllPatients(req, res);

    expect(res.body.patients).toHaveLength(1);
    expect(res.body.patients[0].child_id).toBe('CH-200');
  });
});

describe('generateAuditNJEIS name search against encrypted patient_first_name/last_name', () => {
  it('filters to only the matching child before grouping into NJEIS forms', async () => {
    pool.query
      .mockResolvedValueOnce({ // resolvePatientIdsByName's own patients scan
        rows: [
          { id: 10, first_name: encryptField('Luz'), last_name: encryptField('Quintero') },
          { id: 20, first_name: encryptField('Zoe'), last_name: encryptField('Yang') },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ legal_entity_name: 'Test Agency' }] }) // getCompanyName
      .mockResolvedValueOnce({
        rows: [
          { id: 2, service_date: '2026-10-06', patient_id: 20, patient_first_name: encryptField('Zoe'), patient_last_name: encryptField('Yang'), practitioner_id: 3, practitioners: { first_name: 'Omar', last_name: 'Abernathy', position_title: 'PT' } },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 20, first_name: encryptField('Zoe'), last_name: encryptField('Yang'), dob: encryptField('2024-01-01'), county: 'Essex', child_id: 'CH-200' }] }); // patient lookup for group 20
    const { req, res } = mockReqRes({}, { patientSearch: 'Yang' });
    await generateAuditNJEIS(req, res);
    // The main query is now scoped by the resolved patient_id (10 excluded,
    // 20 kept) BEFORE the LIMIT, not filtered after — so only group 20's
    // patient lookup should ever run.
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
