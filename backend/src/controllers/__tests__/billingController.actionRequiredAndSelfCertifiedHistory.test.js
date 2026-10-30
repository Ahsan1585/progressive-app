// Fix for Important finding I5 from the final whole-branch review of
// docs/superpowers/plans/2026-10-30-child-pii-field-encryption.md:
// getSelfCertifiedHistory (reachable from mobile SevfHistory.tsx) and
// getActionRequiredLogs both returned raw, undecrypted patient_first_name/
// patient_last_name.
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');

function mockReqRes() {
  const req = { practitioner: { practitionerId: 3 } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}
afterEach(() => jest.resetAllMocks());

describe('getSelfCertifiedHistory', () => {
  it('returns decrypted patientName, not ciphertext', async () => {
    const { getSelfCertifiedHistory } = require('../billingController');
    pool.query.mockResolvedValueOnce({
      rows: [{
        batch_id: 1, njeis_path: null, invoice_path: null, start_date: '2026-10-01', end_date: '2026-10-31', created_at: new Date(),
        patient_id: 5, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), company_affiliation: null,
      }],
    });
    const { req, res } = mockReqRes();
    await getSelfCertifiedHistory(req, res);
    expect(res.body.batches[0].patientName).toBe('Luz Quintero');
  });
});

describe('getActionRequiredLogs', () => {
  it('returns decrypted patient_first_name/patient_last_name', async () => {
    const { getActionRequiredLogs } = require('../billingController');
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, patient_id: 5, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
        patient_dob: encryptField('2024-03-05'),
      }],
    });
    const { req, res } = mockReqRes();
    await getActionRequiredLogs(req, res);
    expect(res.body.logs[0].patient_first_name).toBe('Luz');
    expect(res.body.logs[0].patient_last_name).toBe('Quintero');
    expect(res.body.logs[0].patient_dob).toBe('2024-03-05');
  });
});
