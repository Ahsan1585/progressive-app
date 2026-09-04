const ExcelJS = require('exceljs');
const { normalizeForMatch } = require('./textMatch');

// Shared by every "upload an Excel file, auto-detect its header row and
// columns" feature in this app (EIMS compliance-doc upload in
// companyController.js, practitioner bulk-import in
// practitionerImportController.js) — one place for the ExcelJS load +
// header-row detection instead of duplicating it per feature.
async function readWorkbookFromBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

// Real-world exports (state systems, HR spreadsheets) often have a few
// metadata/title rows above the real header row, so its position isn't
// fixed — locate it by content: the first row (within `maxScan`) that
// contains a cell matching one of `requiredHeaderCandidates` once
// normalized (a single string is treated as a one-item list — e.g. the
// state's export format always literally says "Service Date", but a
// general HR roster might header its email column "Email", "Email
// Address", or "E-mail", so this feature passes the field's whole
// candidates list rather than one exact string). Returns { rowNumber,
// headers } (the row's non-empty string cell values, in column order) or
// null if no such row is found.
function findHeaderRow(sheet, requiredHeaderCandidates, maxScan = 20) {
  const candidates = Array.isArray(requiredHeaderCandidates) ? requiredHeaderCandidates : [requiredHeaderCandidates];
  const targets = candidates.map(normalizeForMatch);
  const scanLimit = Math.min(sheet.rowCount, maxScan);
  for (let r = 1; r <= scanLimit; r++) {
    const row = sheet.getRow(r);
    const values = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (typeof v === 'string' && v.trim()) values.push(v.trim());
    });
    if (values.some((v) => targets.includes(normalizeForMatch(v)))) {
      return { rowNumber: r, headers: values };
    }
  }
  return null;
}

module.exports = { readWorkbookFromBuffer, findHeaderRow };
