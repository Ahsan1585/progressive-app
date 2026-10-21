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
      });
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
