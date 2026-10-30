process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/consentNotify', () => ({ notifyConsentStaff: jest.fn() }));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');
const { viewConsent } = require('../consentManageController');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(h) { Object.assign(this.headers, h); return this; },
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; },
  };
}

afterEach(() => jest.resetAllMocks());

describe('consent manage DOB verification against an encrypted patient_dob', () => {
  it('succeeds when the parent types the correct DOB, even though the stored value is ciphertext', async () => {
    pool.query
      // loadRequest's SELECT: patient_dob is now ciphertext in the row
      .mockResolvedValueOnce({ rows: [{ id: 1, manage_token_hash: 'h', manage_failed_attempts: 0, manage_locked_at: null, consent_id: 7, patient_id: 5, patient_dob: encryptField('2024-03-05'), patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero') }] })
      // checkDobOrFail's claim-attempt UPDATE
      .mockResolvedValueOnce({ rows: [{ manage_failed_attempts: 1, manage_locked_at: null }] })
      // success-path reset UPDATE
      .mockResolvedValueOnce({ rows: [] })
      // loadConsent
      .mockResolvedValueOnce({ rows: [{ id: 7, revoked_at: null, expires_at: null, record_types: ['session_logs'] }] });

    const req = { params: { token: 'a'.repeat(64) }, body: { dob: '2024-03-05' } };
    const res = mockRes();

    await viewConsent(req, res);

    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(423);
  });

  it('still rejects an incorrect DOB against the same encrypted stored value', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, manage_token_hash: 'h', manage_failed_attempts: 0, manage_locked_at: null, consent_id: 7, patient_id: 5, patient_dob: encryptField('2024-03-05'), patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero') }] })
      .mockResolvedValueOnce({ rows: [{ manage_failed_attempts: 1, manage_locked_at: null }] });

    const req = { params: { token: 'a'.repeat(64) }, body: { dob: '1999-01-01' } };
    const res = mockRes();

    await viewConsent(req, res);

    expect(res.statusCode).toBe(403);
  });
});
