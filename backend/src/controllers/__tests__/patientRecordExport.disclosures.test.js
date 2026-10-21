jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn() }));

const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { getCompanyName } = require('../../utils/companyName');
const { REDISCLOSURE_NOTICE } = require('../../utils/emailClient');
const {
  exportPatientRecord,
  drawCoverPage,
  buildDisclosureRows,
  buildConsentRows,
} = require('../patientRecordExportController');

afterEach(() => jest.resetAllMocks());

describe('cover page redisclosure notice (34 CFR 99.33 / 303.414)', () => {
  test('the full notice is drawn on the cover page', async () => {
    const drawn = [];
    const fakePage = { drawText: jest.fn((t) => drawn.push(t)), drawLine: jest.fn(), drawRectangle: jest.fn() };
    const fakeDoc = {
      addPage: jest.fn(() => fakePage),
      embedFont: jest.fn(async () => ({ widthOfTextAtSize: (t, size) => t.length * size * 0.5 })),
    };
    await drawCoverPage(fakeDoc, { first_name: 'Timmy', last_name: 'T' }, 'Acme', 'me@x.com');
    const text = drawn.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain(REDISCLOSURE_NOTICE);
  });
});

describe('buildDisclosureRows (34 CFR 99.32 / 303.406)', () => {
  const at = '2026-10-20T15:00:00Z';
  test('lists recipient, purpose, date and records for each disclosure, ignoring non-disclosure rows', () => {
    const rows = buildDisclosureRows([
      { action: 'patient_assessments_view', created_at: at, details: null },
      {
        action: 'sevf_emailed_to_agency', created_at: at,
        details: { recipientName: 'ABC Billing', recipientEmail: 'billing@abc.org', purpose: 'Billing', records: ['SEVF', 'Invoice'] },
      },
      {
        action: 'shared_document_downloaded', created_at: at,
        details: JSON.stringify({ recipientEmail: 'billing@abc.org', records: ['Invoice'] }),
      },
      {
        action: 'patient_record_export', created_at: at,
        details: { recipientName: 'Parent/guardian', purpose: 'Record access request', records: ['Full record'] },
      },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([expect.any(String), 'ABC Billing <billing@abc.org>', 'Billing', 'SEVF, Invoice']);
    expect(rows[1][1]).toBe('billing@abc.org');
    expect(rows[1][3]).toBe('Invoice');
    expect(rows[1][2]).toMatch(/download/i);
    expect(rows[2][1]).toBe('Parent/guardian');
  });
});

describe('exportPatientRecord', () => {
  test("reads the child's access history by resource_type 'patient' + String(id) (where SEVF sends are now logged) and logs the export as a disclosure", async () => {
    getCompanyName.mockResolvedValue('Acme');
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10, first_name: 'Timmy', last_name: 'T' }] }) // patient
      .mockResolvedValueOnce({ rows: [] }) // assessments
      .mockResolvedValueOnce({
        rows: [{
          action: 'sevf_emailed_to_agency', resource_type: 'patient', resource_id: '10', created_at: new Date().toISOString(),
          actor_email: 'jane@x.com', details: { recipientName: 'ABC Billing', recipientEmail: 'billing@abc.org', purpose: 'Billing', records: ['SEVF'] },
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // consents on file
    const req = { params: { id: '10' }, query: {}, practitioner: { email: 'office@x.com' }, headers: {} };
    const res = { setHeader: jest.fn(), send: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };

    await exportPatientRecord(req, res);

    expect(res.status).not.toHaveBeenCalled();
    const [sql, params] = pool.query.mock.calls[2];
    expect(sql).toMatch(/al\.resource_type = 'patient' AND al\.resource_id = \$1/);
    expect(params[0]).toBe('10');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'patient_record_export', resourceType: 'patient', resourceId: '10',
      details: expect.objectContaining({ purpose: expect.any(String), records: expect.any(Array), recipientName: expect.any(String) }),
    }));
    expect(res.send).toHaveBeenCalled();
  });
});

describe('buildConsentRows (Consents on file)', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  test('lists recipient, purpose, records, source, signed date, expiry and status', () => {
    const rows = buildConsentRows([
      { recipient_name: 'ABC Billing', recipient_email: 'b@abc.org', purpose: 'Billing', record_types: ['sevf_forms', 'invoices'], source: 'paper', signed_on: '2026-10-01', granted_at: '2026-10-02T14:00:00Z', expires_at: '2027-10-02T14:00:00Z', revoked_at: null },
      { recipient_name: 'XYZ', purpose: 'Audit', record_types: ['session_logs'], source: 'electronic', signed_on: null, granted_at: '2026-10-05T14:00:00Z', expires_at: '2027-10-05T14:00:00Z', revoked_at: null },
      { recipient_name: 'Old', purpose: 'Legacy', record_types: ['full_record_export'], source: null, granted_at: '2025-01-05T14:00:00Z', expires_at: '2026-01-05T14:00:00Z', revoked_at: null },
      { recipient_name: 'Gone', purpose: 'X', record_types: ['invoices'], source: 'paper', signed_on: '2026-09-01', granted_at: '2026-09-02T14:00:00Z', expires_at: '2027-09-02T14:00:00Z', revoked_at: '2026-10-01T00:00:00Z' },
    ], now);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(['ABC Billing', 'Billing', 'SEVF forms, Invoices', 'Paper', '10/1/2026', '10/2/2027', 'Active']);
    expect(rows[1][3]).toBe('Electronic');
    expect(rows[1][4]).toBe('10/5/2026');
    expect(rows[1][6]).toBe('Active');
    expect(rows[2][3]).toMatch(/legacy/i);
    expect(rows[2][6]).toBe('Expired');
    expect(rows[3][6]).toBe('Revoked');
  });
});

describe('exportPatientRecord consents section', () => {
  test("queries this child's consents and still sends the PDF", async () => {
    getCompanyName.mockResolvedValue('Acme');
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10, first_name: 'Timmy', last_name: 'T' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ recipient_name: 'ABC', purpose: 'Billing', record_types: ['invoices'], source: 'electronic', granted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1e9).toISOString(), revoked_at: null }] });
    const req = { params: { id: '10' }, query: {}, practitioner: { email: 'office@x.com' }, headers: {} };
    const res = { setHeader: jest.fn(), send: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    await exportPatientRecord(req, res);
    const consentCall = pool.query.mock.calls.find(([sql]) => /FROM records_consents/.test(sql));
    expect(consentCall).toBeDefined();
    expect(consentCall[1]).toEqual(['10']);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });
});

describe('free text the WinAnsi PDF font cannot encode (consents + disclosures)', () => {
  const nasty = { lodz: 'Łódź Clinic', korean: '서울 클리닉', emoji: 'Billing 📄✅' };

  test('buildConsentRows replaces unencodable characters with ? (one per character, emoji included)', () => {
    const [row] = buildConsentRows([{
      recipient_name: nasty.lodz, purpose: nasty.emoji, record_types: ['invoices'], source: 'paper',
      signed_on: '2026-10-01', granted_at: '2026-10-02T14:00:00Z', expires_at: '2099-10-02T14:00:00Z', revoked_at: null,
    }], new Date('2026-10-21T12:00:00Z'));
    expect(row[0]).toBe('?ód? Clinic');
    expect(row[1]).toBe('Billing ??');
  });

  test('buildDisclosureRows sanitizes recipient, purpose and records; keeps encodable punctuation', () => {
    const [row] = buildDisclosureRows([{
      action: 'sevf_emailed_to_agency', created_at: '2026-10-20T15:00:00Z',
      details: { recipientName: nasty.korean, recipientEmail: 'a@b.org', purpose: `${nasty.lodz}\nline2`, records: [nasty.emoji, 'SEVF — café'] },
    }]);
    expect(row[1]).toBe('?? ??? <a@b.org>');
    expect(row[2]).toBe('?ód? Clinic line2');
    expect(row[3]).toBe('Billing ??, SEVF — café');
  });

  test('a full export with Łódź / Korean / emoji in consents and disclosures still produces the PDF (no 500)', async () => {
    getCompanyName.mockResolvedValue('Acme');
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10, first_name: 'Timmy', last_name: 'T' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          action: 'sevf_emailed_to_agency', resource_type: 'patient', resource_id: '10', created_at: new Date().toISOString(),
          actor_email: 'jane@x.com', details: { recipientName: nasty.korean, recipientEmail: 'k@x.org', purpose: nasty.emoji, records: [nasty.lodz] },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ recipient_name: nasty.lodz, purpose: nasty.korean, record_types: ['invoices'], source: 'electronic', granted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1e9).toISOString(), revoked_at: null }] });
    const req = { params: { id: '10' }, query: {}, practitioner: { email: 'office@x.com' }, headers: {} };
    const res = { setHeader: jest.fn(), send: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await exportPatientRecord(req, res);
    errSpy.mockRestore();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });
});
