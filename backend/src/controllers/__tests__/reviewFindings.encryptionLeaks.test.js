// Fixes for Critical findings C2/C3 from the final whole-branch review of
// docs/superpowers/plans/2026-10-30-child-pii-field-encryption.md: two
// patientController endpoints and two billingController/reportController
// invoice-generation sites returned raw, undecrypted patients/assessments
// rows — the client then echoed that ciphertext back into a write
// (editLog, createAssessment), causing silent double-encryption, and the
// invoice sites printed ciphertext names directly onto a PDF.
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/tenantContext', () => ({
  getCurrentTenantDb: jest.fn(() => 'test-tenant'),
}));
jest.mock('../../constants/dropdownOptionsCache', () => ({
  getDropdownOptionsCache: jest.fn(() => ({})),
}));
const { pool } = require('../../config/db');
const { encryptField, decryptField } = require('../../utils/fieldEncryption');

function mockReqRes(body = {}, params = {}) {
  const req = { body, params, practitioner: { practitionerId: 3 } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}
afterEach(() => pool.query.mockReset());

describe('patientController.updatePatientStatus (C2)', () => {
  it('returns decrypted first_name/last_name/dob, not ciphertext', async () => {
    const { updatePatientStatus } = require('../patientController');
    pool.query
      .mockResolvedValueOnce({ rows: [{ patient_id: 5 }] }) // patient_practitioners UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), dob: encryptField('2024-03-05') }] }); // SELECT * FROM patients

    const { req, res } = mockReqRes({ status: 'inactive' }, { id: '5' });
    await updatePatientStatus(req, res);

    expect(res.body.data.first_name).toBe('Luz');
    expect(res.body.data.last_name).toBe('Quintero');
    expect(res.body.data.dob).toBe('2024-03-05');
  });
});

describe('patientController.getPatientAssessments (C2)', () => {
  it('returns decrypted patient_first_name/patient_last_name/session_notes, not ciphertext', async () => {
    const { getPatientAssessments } = require('../patientController');
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // ownership check
      .mockResolvedValueOnce({
        rows: [{
          id: 10, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
          session_notes: encryptField('Worked on stacking rings.'),
        }],
      });

    const { req, res } = mockReqRes({}, { id: '5' });
    await getPatientAssessments(req, res);

    expect(res.body[0].patient_first_name).toBe('Luz');
    expect(res.body[0].patient_last_name).toBe('Quintero');
    expect(res.body[0].session_notes).toBe('Worked on stacking rings.');
  });
});

describe('billingController.generateFinancialInvoice (C3)', () => {
  it('decrypts patient_first_name/patient_last_name on the fetched assessment rows before they reach buildInvoiceLines', async () => {
    // buildInvoiceLines (invoiceData.js) reads a.patient_first_name/
    // a.patient_last_name directly off each row it's given, with no
    // decryption of its own (confirmed pure function, per the plan) — so
    // the only correct place to verify this fix is that the rows
    // generateFinancialInvoice builds are already decrypted. Use
    // decryptAssessmentRow directly on the same encrypted fixture the
    // controller's query would return, confirming the controller's
    // `.map(decryptAssessmentRow)` line is present and correct, the same
    // way Task 2's own fieldEncryption.test.js verifies the helper.
    const { decryptAssessmentRow } = require('../../utils/fieldEncryption');
    const encryptedRow = {
      id: 1, practitioner_id: 3, billing_batch_id: null, service_date: '2026-10-01', total_time: 60,
      patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
    };
    const decrypted = decryptAssessmentRow(encryptedRow);
    expect(decrypted.patient_first_name).toBe('Luz');
    expect(decrypted.patient_last_name).toBe('Quintero');

    // Confirm the source line actually calls it: grep the real controller
    // source for the exact rawAssessments.map(decryptAssessmentRow) fix.
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'billingController.js'), 'utf8');
    const fnStart = source.indexOf('const generateFinancialInvoice = async');
    const fnBody = source.slice(fnStart, fnStart + 2000);
    expect(fnBody).toMatch(/rawAssessments\.map\(decryptAssessmentRow\)/);
  });
});

describe('reportController.issueInvoiceOverride (C3)', () => {
  it('decrypts the fetched assessment rows before grouping them for the override invoice', () => {
    // This function's full path requires a live tenant context
    // (buildInvoiceLines -> serviceCodeLabel -> getDropdownOptionsCache)
    // and uploads to GCS, both orthogonal to this fix. Verify the fix the
    // same way generateFinancialInvoice's test above does: confirm the
    // helper round-trips this exact fixture, and confirm the controller's
    // source actually calls it at the right place.
    const { decryptAssessmentRow } = require('../../utils/fieldEncryption');
    const decrypted = decryptAssessmentRow({
      patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
    });
    expect(decrypted.patient_first_name).toBe('Luz');
    expect(decrypted.patient_last_name).toBe('Quintero');

    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'reportController.js'), 'utf8');
    const fnStart = source.indexOf('const issueInvoiceOverride = async');
    const fnBody = source.slice(fnStart, fnStart + 2000);
    expect(fnBody).toMatch(/rawAssessments\.map\(decryptAssessmentRow\)/);
  });
});
