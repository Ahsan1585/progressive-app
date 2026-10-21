jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/storage', () => ({
  BILLING_INVOICES_BUCKET: 'test-bucket',
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));
jest.mock('../../utils/emailClient', () => ({ sendSevfToAgencyEmail: jest.fn().mockResolvedValue() }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/recordsConsent', () => ({ checkConsent: jest.fn() }));
jest.mock('../sharedDocumentController', () => ({
  createSharedDocumentLink: jest.fn(),
  revokeSharedDocumentLink: jest.fn(),
}));

const { pool } = require('../../config/db');
const { sendSevfToAgencyEmail } = require('../../utils/emailClient');
const { checkConsent } = require('../../utils/recordsConsent');
const { downloadFile } = require('../../config/storage');
const { logAudit } = require('../../utils/auditLog');
const { createSharedDocumentLink, revokeSharedDocumentLink } = require('../sharedDocumentController');
const { emailSevfToAgency } = require('../billingController');

const LINK = { linkId: 77, url: 'https://api.example.com/api/shared-documents/acme/' + 'f'.repeat(64), expiresAt: new Date('2026-11-04T00:00:00Z') };

describe('emailSevfToAgency consent gate', () => {
  beforeEach(() => {
    createSharedDocumentLink.mockResolvedValue(LINK);
  });
  afterEach(() => jest.resetAllMocks());

  const baseReq = () => ({
    practitioner: { practitionerId: 7, slug: 'acme' },
    body: { batchId: 'batch-uuid-1', agencyEmail: 'billing@abc.org' },
    protocol: 'https',
    get: (h) => (h.toLowerCase() === 'host' ? 'api.example.com' : undefined),
    headers: {},
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
    expect(createSharedDocumentLink).not.toHaveBeenCalled();
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
    const req = { ...baseReq(), body: { batchId: 'batch-uuid-1', agencyEmail: 'wrong-address@other-agency.org' } };
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

    await emailSevfToAgency(req, res);

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sevf_disclosure_blocked_no_consent',
      resourceType: 'billing_batch',
      resourceId: 'batch-uuid-1',
      details: expect.objectContaining({ agencyEmail: 'billing@abc.org' }),
    }));
  });
  // Resend cannot sign a BAA: the SEVF/invoice PDFs must never be attached —
  // only an expiring secure link (sharedDocumentController) is emailed.
  test('emails a secure link created after the consent gate, never the PDFs', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup({ invoicePath: 'invoice.pdf' });
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 42 });

    await emailSevfToAgency(req, res);

    expect(checkConsent.mock.invocationCallOrder[0]).toBeLessThan(createSharedDocumentLink.mock.invocationCallOrder[0]);
    expect(createSharedDocumentLink).toHaveBeenCalledWith({
      batchId: 'batch-uuid-1', patientId: 10, recipientEmail: 'billing@abc.org', createdBy: 7,
      companySlug: 'acme', baseUrl: 'https://api.example.com',
    });
    expect(downloadFile).not.toHaveBeenCalled();
    const [to, args] = sendSevfToAgencyEmail.mock.calls[0];
    expect(to).toBe('billing@abc.org');
    expect(args).toEqual({ practitionerName: 'Jane Doe', downloadUrl: LINK.url, expiresAt: LINK.expiresAt, includesInvoice: true });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'SEVF and invoice emailed to the agency.' }));
  });

  // 34 CFR 99.32 / 303.406: the disclosure must be in THIS CHILD's access
  // history, which patientRecordExportController builds from audit_logs
  // WHERE resource_type = 'patient' AND resource_id = String(patientId).
  test('logs the SEVF send against the child (resourceType patient + patient id) with disclosure details', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup({ invoicePath: 'invoice.pdf' });
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 42 });

    await emailSevfToAgency(req, res);

    const childRows = logAudit.mock.calls.map((c) => c[0]).filter((a) => a.resourceType === 'patient' && String(a.resourceId) === '10');
    const sent = childRows.find((a) => a.action === 'sevf_emailed_to_agency');
    expect(sent).toBeDefined();
    expect(sent.details).toEqual(expect.objectContaining({
      recipientName: 'ABC Billing', recipientEmail: 'billing@abc.org', consentId: 42, batchId: 'batch-uuid-1',
      purpose: expect.any(String), records: ['SEVF', 'Invoice'], linkId: 77,
    }));
    expect(childRows.find((a) => a.action === 'shared_document_link_created')).toBeDefined();
    // The original batch-level row is kept so nothing that reads it breaks.
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sevf_emailed_to_agency', resourceType: 'billing_batch', resourceId: 'batch-uuid-1',
    }));
  });

  test('revokes the link and returns 500 if the email send fails', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup();
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 42 });
    sendSevfToAgencyEmail.mockRejectedValueOnce(new Error('resend down'));

    await emailSevfToAgency(req, res);

    expect(revokeSharedDocumentLink).toHaveBeenCalledWith(77);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'sevf_emailed_to_agency' }));
  });
});
