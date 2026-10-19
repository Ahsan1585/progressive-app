jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/storage', () => ({
  BILLING_INVOICES_BUCKET: 'test-bucket',
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));
jest.mock('../../utils/emailClient', () => ({ sendSevfToAgencyEmail: jest.fn().mockResolvedValue() }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/recordsConsent', () => ({ checkConsent: jest.fn() }));

const { pool } = require('../../config/db');
const { sendSevfToAgencyEmail } = require('../../utils/emailClient');
const { checkConsent } = require('../../utils/recordsConsent');
const { emailSevfToAgency } = require('../billingController');

describe('emailSevfToAgency consent gate', () => {
  afterEach(() => jest.clearAllMocks());

  const baseReq = () => ({
    practitioner: { practitionerId: 7 },
    body: { batchId: 'batch-uuid-1', agencyEmail: 'billing@abc.org' },
  });

  function mockBatchLookup({ patientId = 10, companyAffiliation = 'ABC Billing', njeisPath = 'sevf.pdf', invoicePath = null } = {}) {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'batch-uuid-1', njeis_path: njeisPath, invoice_path: invoicePath,
        first_name: 'Jane', last_name: 'Doe', patient_id: patientId, company_affiliation: companyAffiliation,
      }],
    });
  }

  test('blocks the send and returns 400 when checkConsent reports ok:false', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup();
    checkConsent.mockResolvedValueOnce({ ok: false, reason: 'No consent on file for "ABC Billing" covering sevf_forms for this child.' });

    await emailSevfToAgency(req, res);

    expect(checkConsent).toHaveBeenCalledWith(10, 'ABC Billing', ['sevf_forms']);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringContaining('No consent on file'),
    }));
    expect(sendSevfToAgencyEmail).not.toHaveBeenCalled();
  });

  test('requires invoices consent too when an invoice is attached', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup({ invoicePath: 'invoice.pdf' });
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 99 });

    await emailSevfToAgency(req, res);

    expect(checkConsent).toHaveBeenCalledWith(10, 'ABC Billing', ['sevf_forms', 'invoices']);
  });

  test('sends and logs the consentId when checkConsent reports ok:true', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup();
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 42 });
    const { logAudit } = require('../../utils/auditLog');

    await emailSevfToAgency(req, res);

    expect(sendSevfToAgencyEmail).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sevf_emailed_to_agency',
      details: expect.objectContaining({ consentId: 42 }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('falls back to the raw agency email as the recipient name when company_affiliation is null', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup({ companyAffiliation: null });
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 1 });

    await emailSevfToAgency(req, res);

    expect(checkConsent).toHaveBeenCalledWith(10, 'billing@abc.org', ['sevf_forms']);
  });
});
