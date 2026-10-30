process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({ sendConsentManageEmail: jest.fn() }));
jest.mock('../../utils/consentNotify', () => ({ notifyConsentStaff: jest.fn() }));
const crypto = require('crypto');
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');
const ctrl = require('../consentSigningController');

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() });
const mkReq = (body = {}) => ({
  params: { token: 'tok', companySlug: 'acme' }, body,
  headers: { 'user-agent': 'UA/1.0', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, ip: '1.2.3.4',
});
const future = (ms = 1e8) => new Date(Date.now() + ms).toISOString();
const row = (o = {}) => ({
  id: 'req1', patient_id: 42, token_hash: sha256('tok'), status: 'pending', request_expires_at: future(),
  consent_expires_at: future(365 * 24 * 3600 * 1000), recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org',
  purpose: 'Billing', record_types: ['sevf_forms'], requested_by: 7, parent_email: 'p@x.com',
  patient_dob: encryptField('2024-03-05'), patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
  verify_failed_attempts: 0, verify_locked_at: null, ...o,
});

afterEach(() => jest.resetAllMocks());

describe('consent signing DOB verification against an encrypted patient_dob', () => {
  test('a correct DOB succeeds even though the stored value is ciphertext', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '2024-03-05' }), res);
    expect(res.json.mock.calls[0][0].childName).toBe('Luz Quintero');
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('an incorrect DOB is still rejected against the same encrypted stored value', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] });
    const res = mkRes();
    await ctrl.verifyConsentSigningIdentity(mkReq({ dob: '1999-01-01' }), res);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/Luz|Quintero/);
  });
});
