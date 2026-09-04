const { readWorkbookFromBuffer, findHeaderRow } = require('../utils/excelSheet');
const { TARGET_FIELDS, suggestMapping, resolvePositionTitle, resolveServiceTypes } = require('../constants/practitionerImportMapping');
const { insertInvitedPractitioner } = require('../utils/practitionerRegistration');

// Staff Directory's bulk practitioner import: upload an Excel roster once
// (previewPractitionerImport), confirm/adjust the column mapping, then
// create every valid row as an invite-pending practitioner
// (confirmPractitionerImport) — same invite-link/activation/resend
// machinery as registering one practitioner at a time
// (authController.js's provisionPractitioner), just looped. Deliberately
// practitioner-only: never touches office-staff/role_id.
//
// The uploaded workbook is parsed in memory only and never written to
// storage — unlike the EIMS compliance-doc upload (which keeps its file
// around for monthly re-use), there's no reason to persist a spreadsheet
// full of names/SSNs after this one request completes. The frontend holds
// the file and resends it (as base64) on Confirm.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cellToText(value) {
  if (value == null) return null;
  if (value instanceof Date) return null;
  if (typeof value === 'object' && value.richText) return value.richText.map((t) => t.text).join('').trim() || null;
  const s = String(value).trim();
  return s || null;
}

async function parseUploadedRoster(fileBase64) {
  const base64Data = fileBase64.includes(',') ? fileBase64.slice(fileBase64.indexOf(',') + 1) : fileBase64;
  const buffer = Buffer.from(base64Data, 'base64');
  const sheet = await readWorkbookFromBuffer(buffer);
  const emailField = TARGET_FIELDS.find((f) => f.key === 'email');
  const found = findHeaderRow(sheet, emailField.candidates, 5);
  if (!found) {
    return { error: 'Could not find a header row with an email column (e.g. "Email" or "Email Address") in this file.' };
  }
  return { sheet, ...found };
}

// --- Preview: parse the file, return headers + auto-detected mapping so
// the admin can review/adjust before anything is created. ---
const previewPractitionerImport = async (req, res) => {
  try {
    const { fileBase64 } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'fileBase64 is required' });

    const parsed = await parseUploadedRoster(fileBase64);
    if (parsed.error) return res.status(400).json(parsed);

    const { sheet, rowNumber, headers } = parsed;
    res.json({
      success: true,
      headers,
      targetFields: TARGET_FIELDS,
      suggestedMapping: suggestMapping(headers),
      rowCount: sheet.rowCount - rowNumber,
    });
  } catch (error) {
    console.error('Error previewing practitioner roster:', error);
    res.status(500).json({ error: 'Failed to read this file. Make sure it is a valid .xlsx or .xls export.' });
  }
};

// --- Confirm: re-parse the same file with the confirmed mapping, validate
// every row, and create one invited practitioner per valid row. A row that
// fails validation (missing required field, unrecognized discipline/service
// type, duplicate email) is skipped and reported — never fails the whole
// batch. ---
const confirmPractitionerImport = async (req, res) => {
  try {
    const { fileBase64, mapping } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'fileBase64 is required' });
    if (!mapping || typeof mapping !== 'object') return res.status(400).json({ error: 'mapping is required' });

    const requiredMissing = TARGET_FIELDS.filter((f) => f.required && !mapping[f.key]);
    if (requiredMissing.length > 0) {
      return res.status(400).json({ error: `Missing required column mapping(s): ${requiredMissing.map((f) => f.label).join(', ')}` });
    }

    const parsed = await parseUploadedRoster(fileBase64);
    if (parsed.error) return res.status(400).json(parsed);
    const { sheet, rowNumber, headers } = parsed;

    const colIndex = {};
    for (const field of TARGET_FIELDS) {
      const header = mapping[field.key];
      colIndex[field.key] = header ? headers.indexOf(header) + 1 : 0; // 0 = not mapped
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
    const slug = req.practitioner.slug;

    const created = [];
    const skipped = [];

    for (let r = rowNumber + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const get = (key) => (colIndex[key] ? cellToText(row.getCell(colIndex[key]).value) : null);

      const firstName = get('first_name');
      const lastName = get('last_name');
      const email = get('email');
      const payRateRaw = get('pay_rate');
      const positionTitleRaw = get('position_title');
      const serviceTypesRaw = get('service_types');
      const address = get('address');
      const phoneNumber = get('phone_number');
      const ssn = get('ssn');

      // A fully blank row (e.g. trailing spreadsheet whitespace) is silently
      // skipped, not reported — it's not a data-entry mistake to flag.
      if (!firstName && !lastName && !email) continue;

      const rowLabel = `Row ${r}${email ? ` (${email})` : firstName || lastName ? ` (${[firstName, lastName].filter(Boolean).join(' ')})` : ''}`;

      if (!firstName || !lastName || !email) {
        skipped.push({ row: rowLabel, reason: 'Missing first name, last name, or email.' });
        continue;
      }
      const payRate = parseFloat(payRateRaw);
      if (!payRateRaw || Number.isNaN(payRate) || payRate < 0) {
        skipped.push({ row: rowLabel, reason: 'Missing or invalid hourly pay rate.' });
        continue;
      }
      const positionTitle = resolvePositionTitle(positionTitleRaw);
      if (!positionTitle) {
        skipped.push({ row: rowLabel, reason: `Unrecognized position title/discipline: "${positionTitleRaw || ''}".` });
        continue;
      }
      const { codes: serviceTypes, unmatched } = resolveServiceTypes(serviceTypesRaw);
      if (serviceTypes.length === 0) {
        skipped.push({ row: rowLabel, reason: `Unrecognized service type(s): "${serviceTypesRaw || ''}".` });
        continue;
      }

      const result = await insertInvitedPractitioner({
        firstName, lastName, email, address, phoneNumber, payRate, positionTitle,
        ssn, serviceTypes, legacyRole: 'practitioner', resolvedRoleId: null,
        slug, frontendUrl,
      });

      if (!result.ok) {
        skipped.push({ row: rowLabel, reason: result.error });
        continue;
      }
      created.push({
        ...result.practitioner,
        unmatchedServiceTypes: unmatched.length > 0 ? unmatched : undefined,
      });

      // Sequential with a short delay between sends — a large batch fired
      // all at once would exceed the email provider's default rate limit.
      await sleep(600);
    }

    res.json({ success: true, created, skipped });
  } catch (error) {
    console.error('Error confirming practitioner bulk import:', error);
    res.status(500).json({ error: 'Failed to process this file.' });
  }
};

module.exports = { previewPractitionerImport, confirmPractitionerImport };
