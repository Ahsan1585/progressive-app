// Multi-child redaction (34 CFR 303.408): Master Reports' audit PDF/Excel are
// internal, multi-child documents by default (one row per logged session
// across every child a search matches). singleChildMode is an opt-in,
// server-validated guarantee — every row must share one patient_id, or the
// request is rejected — so staff have a safe way to hand a single child's
// report to that child's parent during an inspection, instead of trusting
// an unverified search filter.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));

const { Writable } = require('stream');
const { logAudit } = require('../../utils/auditLog');
const { generateAuditReportPDF, generateAuditReportExcel } = require('../reportController');

afterEach(() => jest.resetAllMocks());

const mockRes = () => {
  // workbook.xlsx.write(res) in generateAuditReportExcel needs a real
  // writable stream, not just a jest.fn() stand-in for res.end().
  const res = new Writable({ write(chunk, enc, cb) { cb(); } });
  res.headers = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  const realEnd = res.end.bind(res);
  res.end = jest.fn((...args) => realEnd(...args));
  return res;
};

const log = (o = {}) => ({
  patient_id: 10, patient_first_name: 'Timmy', patient_last_name: 'T',
  practitioner_id: 3, practitioners: { first_name: 'Sam', last_name: 'Staff' },
  service_date: '2026-10-01', type: 'SI', location: 'Home',
  start_time: '09:00', end_time: '09:45', total_time: 45, billing_status: 'invoiced',
  ...o,
});

describe('generateAuditReportPDF with singleChildMode', () => {
  test('400 when logs span more than one child', async () => {
    const res = mockRes();
    await generateAuditReportPDF({ body: { logs: [log({ patient_id: 10 }), log({ patient_id: 11 })], filters: {}, singleChildMode: true } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/one child/i) });
  });

  test('400 when logs is empty (nothing to guarantee)', async () => {
    const res = mockRes();
    await generateAuditReportPDF({ body: { logs: [], filters: {}, singleChildMode: true } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('succeeds and produces a PDF when every row is the same child', async () => {
    const res = mockRes();
    await generateAuditReportPDF({ body: { logs: [log(), log({ service_date: '2026-10-02' })], filters: {}, singleChildMode: true } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.send).toHaveBeenCalledTimes(1);
    const [buf] = res.send.mock.calls[0];
    expect(Buffer.from(buf).slice(0, 5).toString()).toBe('%PDF-');
  });

  test('without singleChildMode, mixed-child logs are still allowed (internal use unchanged)', async () => {
    const res = mockRes();
    await generateAuditReportPDF({ body: { logs: [log({ patient_id: 10 }), log({ patient_id: 11 })], filters: {} } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledTimes(1);
  });

  test('audits with singleChildMode in the details', async () => {
    const res = mockRes();
    await generateAuditReportPDF({ body: { logs: [log()], filters: {}, singleChildMode: true } }, res);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'audit_report_pdf_download',
      details: expect.objectContaining({ singleChildMode: true }),
    }));
  });
});

describe('generateAuditReportExcel with singleChildMode', () => {
  test('400 when logs span more than one child', async () => {
    const res = mockRes();
    await generateAuditReportExcel({ body: { logs: [log({ patient_id: 10 }), log({ patient_id: 11 })], filters: {}, singleChildMode: true } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/one child/i) });
  });

  test('succeeds and writes a workbook when every row is the same child', async () => {
    const res = mockRes();
    await generateAuditReportExcel({ body: { logs: [log(), log({ service_date: '2026-10-02' })], filters: {}, singleChildMode: true } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
