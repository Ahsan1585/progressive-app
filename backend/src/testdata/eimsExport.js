'use strict';
// Builds the monthly NJEIS "Service Log Report" workbooks an agency would upload
// to Company Information, from the EIMS rows the agency model produced. The
// column headers are exactly the ones the platform auto-maps; times are Excel
// time-of-day cells and dates are real date cells, as in the state's own export.
const ExcelJS = require('exceljs');

const EXPORT_HEADERS = [
  'Child ID', 'Child Name', 'Practitioner', 'Service Date', 'Start Time', 'End Time',
  'Service', 'Service Status', 'Location', 'Group Size', 'IFSP Event ID',
];

const excelTime = (hhmm) => {
  if (!hhmm) return null; // a cancelled or missed visit has no times in the state's log
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(1899, 11, 31, h, m));
};
const usDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const lastDayOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// month ("2026-03") -> rows, in month order
function groupByMonth(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    const key = r.serviceDate.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(r);
  }
  return new Map([...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

// -> Map(month -> { buffer, rowCount, filename })
async function buildMonthlyWorkbooks(eimsRows) {
  const out = new Map();
  for (const [month, rows] of groupByMonth(eimsRows)) {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Service Log Report');
    sheet.addRow(['NJEIS Service Log Report']);
    sheet.addRow([`Begin and End Dates: ${usDate(`${month}-01`)} - ${usDate(lastDayOf(month))}`]);
    sheet.addRow([]);
    const header = sheet.addRow(EXPORT_HEADERS);
    header.font = { bold: true };

    const sorted = [...rows].sort((a, b) => (a.serviceDate + a.startTime + a.childName < b.serviceDate + b.startTime + b.childName ? -1 : 1));
    let eventSeq = 0;
    for (const r of sorted) {
      eventSeq += 1;
      sheet.addRow([
        r.childId, r.childName, r.practitionerName,
        new Date(`${r.serviceDate}T00:00:00Z`), excelTime(r.startTime), excelTime(r.endTime),
        r.serviceLabel, r.visitStatusLabel, r.locationLabel, r.groupLabel,
        r.serviceLabel === 'IFSP Meeting' || r.serviceLabel === 'Transition Planning Conference' ? `E${month.replace('-', '')}${String(eventSeq).padStart(4, '0')}` : '',
      ]);
    }
    sheet.columns.forEach((col) => { col.width = 22; });
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    out.set(month, { buffer, rowCount: sorted.length, filename: `njeis-service-log-${month}.xlsx` });
  }
  return out;
}

module.exports = { buildMonthlyWorkbooks, groupByMonth, EXPORT_HEADERS };
