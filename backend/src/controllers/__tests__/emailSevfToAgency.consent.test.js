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

    expect(checkConsent).toHaveBeenCalledWith(10, 'ABC Billing', ['sevf_forms'], 'billing@abc.org');
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

    expect(checkConsent).toHaveBeenCalledWith(10, 'ABC Billing', ['sevf_forms', 'invoices'], 'billing@abc.org');
  });

  // Final-review fix (Critical finding 1): checkConsent must be called
  // with the ACTUAL destination email (agencyEmail from the request body),
  // not just the free-text affiliation name — otherwise a consent for
  // "ABC Billing" would authorize a send to any address the practitioner
  // happens to type in, since company_affiliation and agencyEmail are two
  // independently-entered fields with no enforced relationship.
  test('passes the real destination email to checkConsent, not just the affiliation name', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      body: { batchId: 'batch-uuid-1', agencyEmail: 'wrong-address@other-agency.org' },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup(); // company_affiliation: 'ABC Billing'
    checkConsent.mockResolvedValueOnce({ ok: false, reason: 'No consent on file for "ABC Billing" at wrong-address@other-agency.org covering sevf_forms for this child.' });

    await emailSevfToAgency(req, res);

    expect(checkConsent).toHaveBeenCalledWith(10, 'ABC Billing', ['sevf_forms'], 'wrong-address@other-agency.org');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sendSevfToAgencyEmail).not.toHaveBeenCalled();
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

    expect(checkConsent).toHaveBeenCalledWith(10, 'billing@abc.org', ['sevf_forms'], 'billing@abc.org');
  });

  // Final-review fix (Important finding 2): the spec requires every
  // blocked disclosure attempt to be audit-logged, not just successful
  // sends — a refused attempt is itself compliance-relevant evidence.
  test('logs the blocked attempt when consent is missing', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup();
    checkConsent.mockResolvedValueOnce({ ok: false, reason: 'No consent on file for "ABC Billing" covering sevf_forms for this child.' });
    const { logAudit } = require('../../utils/auditLog');

    await emailSevfToAgency(req, res);

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sevf_disclosure_blocked_no_consent',
      resourceType: 'billing_batch',
      resourceId: 'batch-uuid-1',
      details: expect.objectContaining({ agencyEmail: 'billing@abc.org' }),
    }));
  });
});
