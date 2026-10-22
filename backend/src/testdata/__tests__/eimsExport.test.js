// The monthly EIMS "Service Log Report" workbook an agency would download and
// upload to Company Information. It has to be readable by the platform's own
// parser, or every compliance result built on it is meaningless.
const ExcelJS = require('exceljs');
const { buildAgency } = require('../realisticAgency');
const { buildMonthlyWorkbooks, EXPORT_HEADERS } = require('../eimsExport');
const { suggestMapping, TARGET_FIELDS } = require('../../constants/complianceMapping');

const agency = buildAgency({ seed: 20260101, today: '2026-10-22' });

const read = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[0];
};

test('one workbook per month from January to October', async () => {
  const books = await buildMonthlyWorkbooks(agency.eimsRows);
  expect([...books.keys()]).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
});

test('the layout matches the real export: a title, a period line, a blank row, then the headers', async () => {
  const books = await buildMonthlyWorkbooks(agency.eimsRows);
  const sheet = await read(books.get('2026-03').buffer);
  expect(sheet.getRow(1).getCell(1).value).toBe('NJEIS Service Log Report');
  expect(sheet.getRow(2).getCell(1).value).toBe('Begin and End Dates: 03/01/2026 - 03/31/2026');
  expect(sheet.getRow(3).getCell(1).value).toBeNull();
  expect(sheet.getRow(4).values.slice(1)).toEqual(EXPORT_HEADERS);
});

test("the platform's own mapper recognises every header, with nothing left unmapped", () => {
  const mapping = suggestMapping(EXPORT_HEADERS);
  for (const f of TARGET_FIELDS) expect(mapping[f.key]).toBeTruthy();
});

test('rows are only the month they belong to, with real dates and times the parser can read', async () => {
  const books = await buildMonthlyWorkbooks(agency.eimsRows);
  const sheet = await read(books.get('2026-05').buffer);
  const rows = [];
  sheet.eachRow((row, n) => { if (n > 4) rows.push(row.values.slice(1)); });
  expect(rows.length).toBe(books.get('2026-05').rowCount);
  expect(rows.length).toBeGreaterThan(300);
  for (const r of rows) {
    const [childId, , , date, start, end] = r;
    expect(String(childId)).toMatch(/^\d{10}$/);
    expect(date instanceof Date && date.toISOString().startsWith('2026-05')).toBe(true);
    const cancelled = /Cancelled|Missed/.test(String(r[7]));
    if (cancelled) {
      // a cancelled or missed visit is in the state's log with a status and no times
      expect(start == null && end == null).toBe(true);
    } else {
      // time-of-day cells round-trip as UTC-anchored Dates whose UTC hour/minute IS the value
      expect(start instanceof Date && end instanceof Date).toBe(true);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    }
  }
});

test('the row count equals what the agency actually entered in EIMS, nothing dropped or invented', async () => {
  const books = await buildMonthlyWorkbooks(agency.eimsRows);
  const total = [...books.values()].reduce((n, b) => n + b.rowCount, 0);
  expect(total).toBe(agency.eimsRows.length);
});

test('labels are the ones the platform maps to codes', async () => {
  const books = await buildMonthlyWorkbooks(agency.eimsRows);
  const sheet = await read(books.get('2026-02').buffer);
  const services = new Set(); const statuses = new Set(); const groups = new Set(); const locations = new Set();
  sheet.eachRow((row, n) => {
    if (n <= 4) return;
    services.add(row.getCell(7).value); statuses.add(row.getCell(8).value); locations.add(row.getCell(9).value); groups.add(row.getCell(10).value);
  });
  for (const s of services) expect(['Developmental Intervention', 'Speech Language Therapy', 'Occupational Therapy', 'Physical Therapy', 'Social Work', 'Family Training', 'Evaluation', 'IFSP Meeting', 'Transition Planning Conference']).toContain(s);
  for (const s of statuses) expect(['Direct Child Service', 'Make Up Direct Child Service', 'Team Mtg – IFSP', 'Transition Planning Conference', 'Practitioner Cancelled (inc weather related)', 'Family Cancelled (inc weather related)', 'Family Missed (within 3 hours)']).toContain(s);
  for (const s of locations) expect(['Home', 'EC Program - Inclusive Community', 'Service Provider Clinic/Office', 'Phone/Video Conferencing']).toContain(s);
  for (const s of groups) expect(['Direct Child Service - Individual', 'Consultation/Facilitation with Others', 'Evaluation/Assessment']).toContain(s);
});
