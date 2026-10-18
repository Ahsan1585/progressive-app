const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { normalizeForMatch } = require('./textMatch');

// Some .xlsx generators (non-Microsoft tools/scripts — seen from a
// third-party test-data export) produce spreadsheetml XML with every tag
// under a prefixed namespace, e.g. <x:workbook>, <x:sheet>, <x:sst>,
// instead of the unprefixed <workbook>/<sheet>/<sst> real Excel always
// writes. That's valid XML and a valid OOXML part, but ExcelJS's SAX-based
// parser matches tag names literally and never recognizes the prefixed
// forms — workbook.sheets comes back undefined, which crashes deeper in
// ExcelJS with an opaque "Cannot read properties of undefined (reading
// 'sheets')". Stripping the prefix (and any xmlns:<prefix> declaration
// that isn't the OOXML relationships namespace, which some parts also use
// prefixed and DOES need to stay intact for r:id attributes to resolve)
// from every xl/*.xml part before handing the buffer to ExcelJS fixes this
// whole class of file without needing the source file re-saved.
function stripXmlNamespacePrefixes(xml) {
  return xml
    .replace(/<(\/?)([a-zA-Z][\w.]*):/g, '<$1')
    .replace(/\sxmlns:[a-zA-Z][\w.]*="[^"]*"/g, (m) => (m.includes('/relationships') ? m : ''));
}

async function normalizeNamespacedWorkbook(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return buffer; // not a zip at all — let ExcelJS's own error surface
  }
  let touched = false;
  const entries = Object.keys(zip.files).filter(
    (name) => name.startsWith('xl/') && name.endsWith('.xml') && !zip.files[name].dir
  );
  for (const path of entries) {
    const xml = await zip.file(path).async('string');
    // Only the first tag needs checking — a prefixed root element means
    // the whole part was generated that way, not just one tag within it.
    if (/<[a-zA-Z][\w.]*:[a-zA-Z]/.test(xml.slice(0, 500))) {
      zip.file(path, stripXmlNamespacePrefixes(xml));
      touched = true;
    }
  }
  if (!touched) return buffer;
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Shared by every "upload an Excel file, auto-detect its header row and
// columns" feature in this app (EIMS compliance-doc upload in
// companyController.js, practitioner bulk-import in
// practitionerImportController.js) — one place for the ExcelJS load +
// header-row detection instead of duplicating it per feature.
async function readWorkbookFromBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
    if (!workbook.worksheets[0]) throw new Error('no worksheets after load');
  } catch {
    // First attempt failed — retry once against a namespace-normalized
    // copy before giving up (see normalizeNamespacedWorkbook above). Most
    // files never hit this path; the extra unzip/rezip only runs when the
    // straightforward load already failed.
    try {
      const normalized = await normalizeNamespacedWorkbook(buffer);
      await workbook.xlsx.load(normalized);
    } catch {
      // ExcelJS throws an unhelpful internal error (e.g. "Cannot read
      // properties of undefined (reading 'sheets')") when the buffer isn't
      // a real .xlsx — a legacy binary .xls renamed to .xlsx, a corrupted
      // download, or an HTML/CSV export saved with the wrong extension.
      // Give callers a message they can actually act on and surface to the
      // user, instead of letting ExcelJS's internal exception bubble up as
      // a bare 500.
      throw new Error('Could not read this file as an Excel workbook. Make sure it\'s a real .xlsx file (not a renamed .xls, .csv, or HTML export) and isn\'t corrupted.');
    }
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('This Excel file has no worksheets.');
  }
  return sheet;
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
