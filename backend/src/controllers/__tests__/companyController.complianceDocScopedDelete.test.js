// A real incident (2026-10-28): re-uploading a compliance EIMS workbook for
// one month wiped several unrelated months' data because the old code
// deleted everything between MIN(service_date) and MAX(service_date) found
// in the new file — a single stray/misread date anywhere in the file
// silently widened that range. Fixed to delete only the exact calendar
// months present in the new file's valid rows, matching
// deleteComplianceMonthData's own safe month-scoped delete. Also added a
// preview mode so the frontend can show what will be replaced before
// committing.
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

// Builds a minimal compliance workbook: a header row containing "Service
// Date" plus the given data rows (each [childId, serviceDate (JS Date)]).
async function buildWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('EIMS');
  sheet.addRow(['Child ID', 'Service Date']);
  rows.forEach(([childId, date]) => sheet.addRow([childId, date]));
  return wb.xlsx.writeBuffer();
}

const mapping = { child_id: 'Child ID', service_date: 'Service Date' };

function mockTransactionClient() {
  const queries = [];
  const client = {
    query: jest.fn(async (sql, params) => { queries.push([sql, params]); return { rows: [] }; }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return { client, queries };
}

const req = (o = {}) => ({ body: { mapping }, query: {}, ...o });

test('a stray date in a different month does not widen the delete to unrelated months', async () => {
  const buffer = await buildWorkbook([
    ['C100', new Date('2026-01-10')],
    ['C100', new Date('2026-01-21')],
    // A stray/misread row claiming a date in June — in the old MIN..MAX
    // range-delete code, this alone would have wiped every month from
    // January through June. The fix buckets by the exact month of each
    // row, so only January and June are touched, nothing in between.
    ['C100', new Date('2026-06-02')],
  ]);
  downloadFile.mockResolvedValue(buffer);
  pool.query.mockImplementation(async (sql) => {
    if (/FROM company_settings/.test(sql)) return { rows: [{ compliance_doc_path: 'some/path.xlsx' }] };
    return { rows: [] };
  });
  const { client, queries } = mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);

  const deleteQuery = queries.find(([sql]) => /DELETE FROM compliance_state_logs/.test(sql));
  expect(deleteQuery).toBeDefined();
  expect(deleteQuery[0]).toMatch(/to_char\(service_date, 'YYYY-MM'\) = ANY/);
  expect(deleteQuery[1][0].sort()).toEqual(['2026-01', '2026-06']);
  // Never a BETWEEN-style range delete.
  expect(queries.some(([sql]) => /BETWEEN/.test(sql))).toBe(false);
});

test('preview=true reports affected months and existing counts without writing anything', async () => {
  const buffer = await buildWorkbook([
    ['C100', new Date('2026-01-10')],
    ['C100', new Date('2026-02-05')],
  ]);
  downloadFile.mockResolvedValue(buffer);
  pool.query.mockImplementation(async (sql) => {
    if (/FROM patients/.test(sql)) return { rows: [] };
    if (/FROM dropdown_categories/.test(sql)) return { rows: [] };
    if (/FROM company_settings/.test(sql)) return { rows: [{ compliance_doc_path: 'some/path.xlsx' }] };
    if (/GROUP BY to_char\(service_date/.test(sql)) return { rows: [{ month: '2026-01', record_count: 312 }] };
    throw new Error(`unexpected query: ${sql}`);
  });

  const res = mockRes();
  await applyComplianceDocMapping(req({ query: { preview: 'true' } }), res);

  expect(pool.connect).not.toHaveBeenCalled(); // no transaction — nothing written
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    success: true,
    preview: true,
    monthsAffected: expect.arrayContaining([
      { month: '2026-01', existingRecordCount: 312 },
      { month: '2026-02', existingRecordCount: 0 },
    ]),
  }));
});

test('an upload with no valid rows deletes nothing', async () => {
  const buffer = await buildWorkbook([]); // header only, no data rows
  downloadFile.mockResolvedValue(buffer);
  pool.query.mockImplementation(async (sql) => {
    if (/FROM company_settings/.test(sql)) return { rows: [{ compliance_doc_path: 'some/path.xlsx' }] };
    return { rows: [] };
  });
  const { queries } = mockTransactionClient();

  const res = mockRes();
  await applyComplianceDocMapping(req(), res);

  expect(queries.some(([sql]) => /DELETE FROM compliance_state_logs/.test(sql))).toBe(false);
});
