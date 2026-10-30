process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/tenantContext', () => ({
  getCurrentTenantDb: jest.fn(() => 'test-tenant'),
}));
jest.mock('../../constants/dropdownOptionsCache', () => ({
  getDropdownOptionsCache: jest.fn(() => ({})),
  getDropdownCategoriesCache: jest.fn(() => []),
}));
const { pool } = require('../../config/db');
const { encryptField, decryptField } = require('../../utils/fieldEncryption');
const { getRejectedLogs, editLog } = require('../patientController');

function mockReqRes(body = {}, params = {}) {
  const req = { body, params, practitioner: { practitionerId: 3 } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}
afterEach(() => pool.query.mockReset());

describe('getRejectedLogs', () => {
  it('returns decrypted patient_first_name/patient_last_name', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), billing_status: 'rejected' }],
    });
    const { req, res } = mockReqRes();
    await getRejectedLogs(req, res);
    expect(res.body.logs[0].patient_first_name).toBe('Luz');
    expect(res.body.logs[0].patient_last_name).toBe('Quintero');
  });
});

describe("editLog's session_notes write", () => {
  it('encrypts a newly-typed session_notes value before storing it', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, patient_id: 7, billing_status: 'pending', service_date: '2026-10-21', company_affiliation: null, session_notes: null }] }) // ownership lookup
      .mockResolvedValueOnce({ rows: [{ service_types: [] }] }) // practitioner service_types check
      .mockResolvedValueOnce({ rows: [] }) // assertNoConflictingSession
      .mockResolvedValueOnce({ rows: [] }); // the UPDATE

    const { req, res } = mockReqRes(
      { service_date: '2026-10-21', type: 'PT', location: '1', start_time: '10:00', end_time: '11:00', total_time: 60, status: '1', custom_fields: {}, session_notes: 'Worked on stacking rings.' },
      { id: '5' }
    );
    await editLog(req, res);

    const updateCall = pool.query.mock.calls.find(([sql]) => /UPDATE assessments/.test(sql));
    const [, params] = updateCall;
    const notesParam = params[params.length - 2]; // session_notes is the second-to-last param ($11 of 12)
    expect(decryptField(notesParam)).toBe('Worked on stacking rings.');
    expect(notesParam).not.toBe('Worked on stacking rings.');
  });

  it('does not re-encrypt an already-encrypted session_notes value on the "keep existing" branch', async () => {
    const existingCiphertext = encryptField('Old note already in the database.');
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, patient_id: 7, billing_status: 'pending', service_date: '2026-10-21', company_affiliation: null, session_notes: existingCiphertext }] })
      .mockResolvedValueOnce({ rows: [{ service_types: [] }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes(
      { service_date: '2026-10-21', type: 'PT', location: '1', start_time: '10:00', end_time: '11:00', total_time: 60, status: '1', custom_fields: {} },
      { id: '5' }
    );
    await editLog(req, res);

    const updateCall = pool.query.mock.calls.find(([sql]) => /UPDATE assessments/.test(sql));
    const [, params] = updateCall;
    const notesParam = params[params.length - 2];
    expect(notesParam).toBe(existingCiphertext);
  });
});
