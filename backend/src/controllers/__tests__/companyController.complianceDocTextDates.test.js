// A real incident (2026-10-28): a re-saved compliance workbook lost its
// real Excel date formatting for Service Date (485 of 488 rows became
// plain text like "2026-01-06"), and every one of those rows was silently
// dropped with zero warning — only 2 rows (the ones that still had real
// date cells) were ever parsed in. Fixed: excelDateToISO now also accepts
// an unambiguous text date (YYYY-MM-DD or MM/DD/YYYY), and the response
// reports how many rows were skipped and why.
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
  sheet.addRow(['Child ID', 'Service Date']);
  rows.forEach(([childId, date]) => sheet.addRow([childId, date]));
  return wb.xlsx.writeBuffer();
}

const mapping = { child_id: 'Child ID', service_date: 'Service Date' };

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

test('a real Excel date cell still parses (unchanged behavior)', async () => {
  const buffer = await buildWorkbook([['C100', new Date('2026-01-10')]]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ rowsParsed: 1, skippedUnreadableDate: 0 }));
});

test('a text date in YYYY-MM-DD form now parses instead of being silently dropped', async () => {
  const buffer = await buildWorkbook([['C100', '2026-01-06']]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ rowsParsed: 1, skippedUnreadableDate: 0 }));
});

test('a text date in MM/DD/YYYY form also parses', async () => {
  const buffer = await buildWorkbook([['C100', '1/6/2026']]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ rowsParsed: 1, skippedUnreadableDate: 0 }));
});

test('a genuinely unreadable date is still skipped, but now counted and reported', async () => {
  const buffer = await buildWorkbook([
    ['C100', new Date('2026-01-10')],
    ['C100', 'not a date'],
    ['C100', 'Jan 6 2026'], // ambiguous month-name form, deliberately not supported
  ]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ rowsParsed: 1, skippedUnreadableDate: 2 }));
});

test('a row with a valid date but no Child ID is counted separately from an unreadable date', async () => {
  const buffer = await buildWorkbook([['', '2026-01-06']]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();
  mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ rowsParsed: 0, skippedMissingChildId: 1, skippedUnreadableDate: 0 }));
});

test('preview mode also reports skipped-row counts', async () => {
  const buffer = await buildWorkbook([
    ['C100', new Date('2026-01-10')],
    ['C100', 'garbage'],
  ]);
  downloadFile.mockResolvedValue(buffer);
  primeSettings();

  const res = mockRes();
  await applyComplianceDocMapping(req({ query: { preview: 'true' } }), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ preview: true, rowsParsed: 1, skippedUnreadableDate: 1 }));
});
