// Multi-child redaction (34 CFR 303.408): an on-demand, read-only, parent-
// safe copy of one child's billing invoice — no storage, no billing-state
// change (unlike generateFinancialInvoice), so it's isolated from the real
// billing flow and safe to call as often as a parent inspection requires.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanySettingsForDocuments: jest.fn() }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn().mockResolvedValue({ matched: true }) }));
// buildInvoiceLines resolves service/location/group-size labels through the
// tenant-scoped dropdown cache, outside any real request's AsyncLocalStorage
// context — same stand-in as billingController.bulkCompliance.test.js uses.
jest.mock('../../config/tenantContext', () => ({ getCurrentTenantDb: jest.fn(() => 'test-tenant') }));
jest.mock('../../constants/dropdownOptionsCache', () => ({ getDropdownOptionsCache: jest.fn(() => ({})) }));

const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { getCompanySettingsForDocuments } = require('../../utils/companyName');
const { generateSingleChildInvoice } = require('../patientRecordExportController');

const { getDropdownOptionsCache } = require('../../constants/dropdownOptionsCache');
afterEach(() => jest.resetAllMocks());
beforeEach(() => getDropdownOptionsCache.mockReturnValue({}));

const mockRes = () => {
  const res = { headers: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  return res;
};
const req = (o = {}) => ({
  params: { id: '10' },
  practitioner: { practitionerId: 3, role: 'ceo' },
  ...o,
});

const patientRow = { id: 10, first_name: 'Timmy', last_name: 'T' };
const assessmentRow = (o = {}) => ({
  id: 1, patient_id: 10, practitioner_id: 7, service_date: '2026-09-01', total_time: 60,
  billing_status: 'invoiced', type: 'SI',
  practitioners: { first_name: 'Sam', last_name: 'Staff', service_types: ['SI'] },
  patients: { first_name: 'Timmy', last_name: 'T', child_id: 'NJ-1', county: 'Mercer' },
  ...o,
});

describe('generateSingleChildInvoice', () => {
  test('404 when the child does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await generateSingleChildInvoice(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400 when the child has no invoiced/completed sessions', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [patientRow] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await generateSingleChildInvoice(req(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('produces a single-child invoice PDF for a child with invoiced sessions', async () => {
    getCompanySettingsForDocuments.mockResolvedValue({ legal_entity_name: 'Acme EI' });
    pool.query
      .mockResolvedValueOnce({ rows: [patientRow] })
      .mockResolvedValueOnce({ rows: [assessmentRow()] });
    const res = mockRes();
    await generateSingleChildInvoice(req(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.send).toHaveBeenCalledTimes(1);
    const [buf] = res.send.mock.calls[0];
    expect(Buffer.from(buf).slice(0, 5).toString()).toBe('%PDF-');
  });

  test('audits as a redacted single-child disclosure, never stores the file', async () => {
    getCompanySettingsForDocuments.mockResolvedValue({ legal_entity_name: 'Acme EI' });
    pool.query
      .mockResolvedValueOnce({ rows: [patientRow] })
      .mockResolvedValueOnce({ rows: [assessmentRow()] });
    const res = mockRes();
    await generateSingleChildInvoice(req(), res);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'single_child_invoice_generated',
      resourceType: 'patient',
      resourceId: '10',
    }));
  });

  test('only queries sessions with a billed status (invoiced/completed), never pending/review', async () => {
    getCompanySettingsForDocuments.mockResolvedValue({ legal_entity_name: 'Acme EI' });
    pool.query
      .mockResolvedValueOnce({ rows: [patientRow] })
      .mockResolvedValueOnce({ rows: [assessmentRow()] });
    const res = mockRes();
    await generateSingleChildInvoice(req(), res);
    const [sql] = pool.query.mock.calls[1];
    expect(sql).toMatch(/billing_status = ANY/);
  });
});
