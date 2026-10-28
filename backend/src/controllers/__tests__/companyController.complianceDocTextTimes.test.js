// A real incident (2026-10-28, same day as the text-date bug): the same
// re-saved compliance workbook that lost its real Service Date formatting
// also lost real time formatting for Start Time/End Time — they became
// plain text ("15:40") instead of time cells. Unlike Service Date, Start/
// End Time aren't required fields, so no row was dropped or flagged —
// every row just silently lost its times with zero warning, since
// excelTimeToHHMM only accepted a real Date value. Fixed: it now also
// accepts "HH:MM" text, validated so an out-of-range value like "25:99"
// can't slip through as something downstream treats as real.
const ExcelJS = require('exceljs');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../config/storage', () => ({
  NJEIS_FORMS_BUCKET: 'test-bucket',
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  getSignedUrl: jest.fn(),
  removeFiles: jest.fn(),
}));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));

const { pool } = require('../../config/db');
const { downloadFile } = require('../../config/storage');
const { applyComplianceDocMapping } = require('../companyController');

afterEach(() => jest.resetAllMocks());

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

async function buildWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('EIMS');
  sheet.addRow(['Child ID', 'Service Date', 'Start Time', 'End Time']);
  rows.forEach(([childId, date, start, end]) => sheet.addRow([childId, date, start, end]));
  return wb.xlsx.writeBuffer();
}

const mapping = { child_id: 'Child ID', service_date: 'Service Date', start_time: 'Start Time', end_time: 'End Time' };

function mockTransactionClient() {
  const client = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  return client;
}

function primeSettings() {
  pool.query.mockImplementation(async (sql) => {
    if (/FROM company_settings/.test(sql)) return { rows: [{ compliance_doc_path: 'some/path.xlsx' }] };
    return { rows: [] };
  });
}

const req = (o = {}) => ({ body: { mapping }, query: {}, ...o });

// Column index 10 is start_time, 11 is end_time in the INSERT's column
// order (see the INSERT statement in applyComplianceDocMapping).
const START_TIME_COL = 9; // 0-indexed into the row array passed to INSERT
const END_TIME_COL = 10;

test('a real Excel time cell still parses (unchanged behavior)', async () => {
  const buffer = await buildWorkbook([['C100', new Date('2026-01-10'), new Date(Date.UTC(1970, 0, 1, 15, 40)), new Date(Date.UTC(1970, 0, 1, 16, 25))]]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  const client = mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  const insertCall = client.query.mock.calls.find(([sql]) => /INSERT INTO compliance_state_logs/.test(sql));
  expect(insertCall[1][START_TIME_COL]).toBe('15:40');
  expect(insertCall[1][END_TIME_COL]).toBe('16:25');
});

test('a text time like "15:40" now parses instead of being silently dropped', async () => {
  const buffer = await buildWorkbook([['C100', new Date('2026-01-10'), '15:40', '16:25']]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  const client = mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  const insertCall = client.query.mock.calls.find(([sql]) => /INSERT INTO compliance_state_logs/.test(sql));
  expect(insertCall[1][START_TIME_COL]).toBe('15:40');
  expect(insertCall[1][END_TIME_COL]).toBe('16:25');
});

test('an out-of-range text time is rejected, not silently accepted', async () => {
  const buffer = await buildWorkbook([['C100', new Date('2026-01-10'), '25:99', '16:25']]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  const client = mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  const insertCall = client.query.mock.calls.find(([sql]) => /INSERT INTO compliance_state_logs/.test(sql));
  expect(insertCall[1][START_TIME_COL]).toBeNull();
  expect(insertCall[1][END_TIME_COL]).toBe('16:25');
});

test('a missing time (cancelled/missed session) still comes through as null, not an error', async () => {
  const buffer = await buildWorkbook([['C100', new Date('2026-01-10'), null, null]]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  const client = mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  expect(res.status).not.toHaveBeenCalledWith(500);
  const insertCall = client.query.mock.calls.find(([sql]) => /INSERT INTO compliance_state_logs/.test(sql));
  expect(insertCall[1][START_TIME_COL]).toBeNull();
  expect(insertCall[1][END_TIME_COL]).toBeNull();
});
