// Fix for Important finding I4 from the final whole-branch review of
// docs/superpowers/plans/2026-10-30-child-pii-field-encryption.md:
// generateMasterReport grouped sessions by ciphertext childName (every
// session became its own "child" since AES-GCM's random IV never repeats),
// passed an undecrypted patient row to generateNjeisPDF, wrote ciphertext
// into the plaintext master_reports.child_name column, and put ciphertext
// into the GCS object path.
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
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
const { generateMasterReport } = require('../reportController');
const { uploadFile } = require('../../config/storage');
const { generateNjeisPDF } = require('../../utils/njeisGenerator');

function mockReqRes(body = {}) {
  const req = { body };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}
afterEach(() => jest.resetAllMocks());

describe('generateMasterReport (review finding I4)', () => {
  it('groups two sessions for the SAME child into one report, not two, despite each having a distinct AES-GCM ciphertext', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 3, first_name: 'Omar', last_name: 'Abernathy' }] }) // practitioner lookup
      .mockResolvedValueOnce({ rows: [{ display_name: 'Test Agency', legal_entity_name: 'Test Agency' }] }) // getCompanyName
      .mockResolvedValueOnce({
        rows: [
          { id: 1, patient_id: 5, total_time: 60, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero') },
          { id: 2, patient_id: 5, total_time: 30, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero') },
        ],
      }) // pendingEncounters — same child, two different ciphertexts for the same plaintext name
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), dob: encryptField('2024-03-05'), county: 'Essex', child_id: 'CH-100' }] }) // patient lookup
      .mockResolvedValueOnce({ rows: [{ id: 99, child_name: 'Luz Quintero' }] }); // INSERT INTO master_reports RETURNING *

    const { req, res } = mockReqRes({ practitionerId: 3, targetMonth: '10', targetYear: '2026' });
    await generateMasterReport(req, res);

    // Grouped as ONE child, not two — the whole point of this fix.
    expect(generateNjeisPDF).toHaveBeenCalledTimes(1);
    const [, childDataArg, encountersArg] = generateNjeisPDF.mock.calls[0];
    expect(childDataArg.first_name).toBe('Luz');
    expect(childDataArg.last_name).toBe('Quintero');
    expect(encountersArg).toHaveLength(2);

    // The master_reports INSERT and the GCS filename must carry the
    // decrypted, human-readable name, not ciphertext.
    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO master_reports/.test(sql));
    expect(insertCall[1]).toContain('Luz Quintero');
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('Luz_Quintero'), expect.anything(), expect.anything());
  });
});
