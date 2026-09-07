const { readWorkbookFromBuffer, findHeaderRow } = require('../utils/excelSheet');
const { TARGET_FIELDS, suggestMapping, resolvePositionTitle, resolveServiceTypes } = require('../constants/practitionerImportMapping');
const { insertInvitedPractitioner, getValidServiceTypeCodes } = require('../utils/practitionerRegistration');
const { pool } = require('../config/db');

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

    // A `multiple: true` field (currently only service_types) maps to an
    // array of headers instead of one; "missing" means an empty/absent
    // array rather than a falsy string.
    const isFieldMapped = (field) => (field.multiple ? Array.isArray(mapping[field.key]) && mapping[field.key].length > 0 : !!mapping[field.key]);
    const requiredMissing = TARGET_FIELDS.filter((f) => f.required && !isFieldMapped(f));
    if (requiredMissing.length > 0) {
      return res.status(400).json({ error: `Missing required column mapping(s): ${requiredMissing.map((f) => f.label).join(', ')}` });
    }

    const parsed = await parseUploadedRoster(fileBase64);
    if (parsed.error) return res.status(400).json(parsed);
    const { sheet, rowNumber, headers } = parsed;

    // colIndex[key] is a single 1-based column index for most fields, or an
    // array of them for a `multiple: true` field — 0 (or an empty array)
    // means "not mapped".
    const colIndex = {};
    for (const field of TARGET_FIELDS) {
      if (field.multiple) {
        const mappedHeaders = Array.isArray(mapping[field.key]) ? mapping[field.key] : [];
        colIndex[field.key] = mappedHeaders.filter(Boolean).map((h) => headers.indexOf(h) + 1).filter((i) => i > 0);
      } else {
        const header = mapping[field.key];
        colIndex[field.key] = header ? headers.indexOf(header) + 1 : 0; // 0 = not mapped
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
    const slug = req.practitioner.slug;

    // Upfront duplicate check, once, instead of one SELECT per row inside
    // the insert loop: (1) every email already registered in this tenant's
    // practitioners table (case-insensitive, matching insertInvitedPractitioner's
    // own normalization), and (2) any email repeated more than once within
    // this same file — the second (and later) occurrence is reported as an
    // in-file duplicate rather than a confusing "already registered", since
    // nothing was registered yet when this file was uploaded.
    const emailCol = colIndex.email;
    const seenEmails = new Set();
    const duplicateEmailsInFile = new Set();
    for (let r = rowNumber + 1; r <= sheet.rowCount; r++) {
      const raw = emailCol ? cellToText(sheet.getRow(r).getCell(emailCol).value) : null;
      if (!raw) continue;
      const normalized = raw.trim().toLowerCase();
      if (seenEmails.has(normalized)) duplicateEmailsInFile.add(normalized);
      seenEmails.add(normalized);
    }
    let alreadyRegisteredEmails = new Set();
    if (seenEmails.size > 0) {
      const { rows: existingRows } = await pool.query(
        'SELECT email FROM practitioners WHERE LOWER(email) = ANY($1::text[])',
        [[...seenEmails]]
      );
      alreadyRegisteredEmails = new Set(existingRows.map((r) => r.email.toLowerCase()));
    }
    // Only the SECOND-and-later occurrence of a repeated email is flagged as
    // an in-file duplicate — the first occurrence is a normal candidate row
    // (it may still fail on other grounds, but not on this one).
    const emailOccurrenceSeen = new Set();

    const created = [];
    const skipped = [];

    for (let r = rowNumber + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const get = (key) => (colIndex[key] ? cellToText(row.getCell(colIndex[key]).value) : null);
      // Every mapped service-type column's cell (each itself possibly
      // comma/semicolon-separated) joined into one string — resolveServiceTypes
      // below re-splits the whole thing, so a value spread across N columns
      // is handled identically to N values packed into one cell.
      const getMulti = (key) => colIndex[key].map((idx) => cellToText(row.getCell(idx).value)).filter(Boolean).join(', ') || null;

      const firstName = get('first_name');
      const lastName = get('last_name');
      const email = get('email');
      const payRateRaw = get('pay_rate');
      const positionTitleRaw = get('position_title');
      const serviceTypesRaw = getMulti('service_types');
      const address = get('address');
      const phoneNumber = get('phone_number');
      const ssn = get('ssn');

      // A fully blank row (e.g. trailing spreadsheet whitespace) is silently
      // skipped, not reported — it's not a data-entry mistake to flag.
      if (!firstName && !lastName && !email) continue;

      const rowLabel = `Row ${r}${email ? ` (${email})` : firstName || lastName ? ` (${[firstName, lastName].filter(Boolean).join(' ')})` : ''}`;
      // Whatever this row's cells actually contained, raw — carried on every
      // skip entry so the admin can fix just the bad field(s) and resubmit
      // via /bulk-import/retry instead of re-uploading the whole file.
      const rawData = { firstName, lastName, email, payRate: payRateRaw, positionTitle: positionTitleRaw, serviceTypes: serviceTypesRaw, address, phoneNumber, ssn };

      if (!firstName || !lastName || !email) {
        skipped.push({ row: rowLabel, reason: 'Missing first name, last name, or email.', data: rawData });
        continue;
      }
      const normalizedEmail = email.trim().toLowerCase();
      if (alreadyRegisteredEmails.has(normalizedEmail)) {
        skipped.push({ row: rowLabel, reason: `This email is already registered: "${email}".`, data: rawData });
        continue;
      }
      if (duplicateEmailsInFile.has(normalizedEmail)) {
        if (emailOccurrenceSeen.has(normalizedEmail)) {
          skipped.push({ row: rowLabel, reason: `Duplicate email within this file: "${email}" appears more than once — only the first occurrence was kept as a candidate.`, data: rawData });
          continue;
        }
        emailOccurrenceSeen.add(normalizedEmail);
      }
      const payRate = parseFloat(payRateRaw);
      // practitioners.pay_rate is numeric(10,2) — anything at or beyond
      // 10^8 overflows that column and previously threw a raw Postgres
      // error that aborted the whole batch instead of just this row.
      if (!payRateRaw || Number.isNaN(payRate) || payRate < 0 || payRate >= 100000000) {
        skipped.push({ row: rowLabel, reason: `Missing or invalid hourly pay rate: "${payRateRaw || ''}".`, data: rawData });
        continue;
      }
      const positionTitle = resolvePositionTitle(positionTitleRaw);
      if (!positionTitle) {
        skipped.push({ row: rowLabel, reason: `Unrecognized position title/discipline: "${positionTitleRaw || ''}".`, data: rawData });
        continue;
      }
      const { codes: serviceTypes, unmatched } = resolveServiceTypes(serviceTypesRaw);
      if (serviceTypes.length === 0) {
        skipped.push({ row: rowLabel, reason: `Unrecognized service type(s): "${serviceTypesRaw || ''}".`, data: rawData });
        continue;
      }

      const result = await insertInvitedPractitioner({
        firstName, lastName, email, address, phoneNumber, payRate, positionTitle,
        ssn, serviceTypes, legacyRole: 'practitioner', resolvedRoleId: null,
        slug, frontendUrl,
      });

      if (!result.ok) {
        // This row's fields all resolved fine — carry the RESOLVED position
        // title/service types (not the raw sheet text) so a retry (e.g.
        // after the admin changes the duplicate email) doesn't need to
        // re-run resolvePositionTitle/resolveServiceTypes at all.
        skipped.push({ row: rowLabel, reason: result.error, data: { ...rawData, positionTitle, serviceTypes } });
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

// --- Retry: the admin fixed up one or more skipped rows on the results
// screen (editing via the same widgets as the single Register form — a
// Position Title dropdown, a Service Type(s) checklist) and resubmits just
// those. No file re-parse needed — the frontend already holds each row's
// corrected values from the results screen's fix-up table. Unlike Confirm,
// positionTitle/serviceTypes arrive already resolved (a real label / real
// codes picked from a dropdown), not raw sheet text, so no
// resolvePositionTitle/resolveServiceTypes re-matching happens here — only
// the same required-field + pay-rate-bound + valid-service-type-code checks
// every other registration path already applies. ---
const retryPractitionerImportRows = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows is required' });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
    const slug = req.practitioner.slug;
    const validServiceCodes = getValidServiceTypeCodes();

    const created = [];
    const skipped = [];

    for (const row of rows) {
      const { firstName, lastName, email, payRate: payRateRaw, positionTitle, address, phoneNumber, ssn } = row;
      const serviceTypes = Array.isArray(row.serviceTypes) ? row.serviceTypes.filter((c) => validServiceCodes.includes(c)) : [];
      const rowLabel = email || [firstName, lastName].filter(Boolean).join(' ') || 'this row';

      if (!firstName || !lastName || !email) {
        skipped.push({ row: rowLabel, reason: 'Missing first name, last name, or email.', data: row });
        continue;
      }
      const payRate = parseFloat(payRateRaw);
      if (!payRateRaw || Number.isNaN(payRate) || payRate < 0 || payRate >= 100000000) {
        skipped.push({ row: rowLabel, reason: `Missing or invalid hourly pay rate: "${payRateRaw || ''}".`, data: row });
        continue;
      }
      if (!positionTitle) {
        skipped.push({ row: rowLabel, reason: 'A position title/discipline is required.', data: row });
        continue;
      }
      if (serviceTypes.length === 0) {
        skipped.push({ row: rowLabel, reason: 'At least one valid service type is required.', data: row });
        continue;
      }

      const result = await insertInvitedPractitioner({
        firstName, lastName, email, address, phoneNumber, payRate, positionTitle,
        ssn, serviceTypes, legacyRole: 'practitioner', resolvedRoleId: null,
        slug, frontendUrl,
      });

      if (!result.ok) {
        skipped.push({ row: rowLabel, reason: result.error, data: row });
        continue;
      }
      created.push(result.practitioner);

      // Same rate-limit-friendly pacing as the main confirm loop.
      await sleep(600);
    }

    res.json({ success: true, created, skipped });
  } catch (error) {
    console.error('Error retrying practitioner bulk import rows:', error);
    res.status(500).json({ error: 'Failed to register these rows.' });
  }
};

module.exports = { previewPractitionerImport, confirmPractitionerImport, retryPractitionerImportRows };
