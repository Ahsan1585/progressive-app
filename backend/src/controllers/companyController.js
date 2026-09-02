const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const { NJEIS_FORMS_BUCKET, uploadFile, downloadFile, getSignedUrl, removeFiles } = require('../config/storage');
const { TARGET_FIELDS, suggestMapping, norm } = require('../constants/complianceMapping');
const { mapServiceLabelToCode, mapLocationLabelToCode, mapGroupSizeLabelToCode } = require('../constants/njeis');
const { logAudit } = require('../utils/auditLog');

// A resized/compressed PNG data URL comfortably fits well under this — this
// mainly guards against a client sending an uncompressed original by mistake.
// Mirrors MAX_PROFILE_PICTURE_BASE64_LENGTH in index.js.
const MAX_LOGO_BASE64_LENGTH = 2_000_000; // ~1.5MB decoded

// Excel reference documents are larger than a logo but still bounded by
// express.json's 20mb body limit (index.js) — this leaves headroom for the
// base64 inflation (~33%) on top of the JSON envelope for a 10MB file.
const MAX_COMPLIANCE_DOC_BASE64_LENGTH = 14_500_000; // ~10.5MB decoded
const COMPLIANCE_DOC_PREFIX = 'company/compliance-reference/';
const COMPLIANCE_DOC_EXTENSIONS = ['.xlsx', '.xls'];

// Month-by-month snapshot of what's currently in compliance_state_logs,
// scoped live to the rolling 120-day window. The physical DELETE that
// enforces retention only runs when a new file is applied
// (applyComplianceDocMapping), not continuously — so between uploads, rows
// older than 120 days can still be sitting in the table. Filtering by
// service_date here (rather than counting every row physically present)
// means the count is always what's actually "in scope" right now, and
// naturally shrinks day by day as the window rolls forward, independent of
// whenever the last physical purge happened to run. downloadComplianceMonthData
// applies the identical filter so the two always agree.
// Shared by applyComplianceDocMapping (runs inside its transaction, so takes
// a client) and refreshComplianceDocAnalysis (runs standalone against pool,
// for a doc that was applied before this snapshot existed, or to manually
// re-sync the frozen table against the current 120-day window on demand).
async function computeComplianceDocAnalysis(queryable) {
  const { rows: months } = await queryable.query(
    `SELECT to_char(date_trunc('month', service_date), 'YYYY-MM') AS month,
            COUNT(*)::int AS record_count,
            MIN(service_date) AS earliest_date,
            MAX(service_date) AS latest_date
     FROM compliance_state_logs
     WHERE service_date >= CURRENT_DATE - INTERVAL '120 days'
     GROUP BY date_trunc('month', service_date)
     ORDER BY date_trunc('month', service_date)`
  );
  return { generatedAt: new Date().toISOString(), months };
}

const getCompanySettings = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM company_settings WHERE id = 1');
    res.json({ success: true, settings: rows[0] || null });
  } catch (error) {
    console.error('Error fetching company settings:', error);
    res.status(500).json({ error: 'Failed to fetch company settings' });
  }
};

// Explicit allow-list, unlike getCompanySettings above — every authenticated
// role (including practitioners on the mobile app) can hit this to render
// the company name/logo in their own header, but has no business seeing
// legal_entity_name/address/phone/billing_email, so those never leave here.
const getCompanyBranding = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT display_name, logo FROM company_settings WHERE id = 1');
    res.json({ success: true, display_name: rows[0]?.display_name || null, logo: rows[0]?.logo || null });
  } catch (error) {
    console.error('Error fetching company branding:', error);
    res.status(500).json({ error: 'Failed to fetch company branding' });
  }
};

const updateCompanySettings = async (req, res) => {
  const { display_name, legal_entity_name, state, timezone, address, phone, billing_email } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO company_settings (id, display_name, legal_entity_name, state, timezone, address, phone, billing_email, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         legal_entity_name = EXCLUDED.legal_entity_name,
         state = EXCLUDED.state,
         timezone = EXCLUDED.timezone,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         billing_email = EXCLUDED.billing_email,
         updated_at = now()
       RETURNING *`,
      [display_name, legal_entity_name, state, timezone, address, phone, billing_email]
    );
    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error updating company settings:', error);
    res.status(500).json({ error: 'Failed to update company settings' });
  }
};

const updateCompanyLogo = async (req, res) => {
  const { logo } = req.body;
  try {
    if (logo !== null && (typeof logo !== 'string' || !logo.startsWith('data:image/'))) {
      return res.status(400).json({ error: 'logo must be a data:image/... URL or null' });
    }
    if (logo && logo.length > MAX_LOGO_BASE64_LENGTH) {
      return res.status(400).json({ error: 'Image is too large — please use a smaller logo.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO company_settings (id, logo, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET logo = EXCLUDED.logo, updated_at = now()
       RETURNING *`,
      [logo]
    );
    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error updating company logo:', error);
    res.status(500).json({ error: 'Failed to update company logo' });
  }
};

// --- Compliance document parsing helpers -----------------------------------
// The state's NJEIS "Service Log Report" export has a few metadata rows
// before the real header row (title, date range, generated-by, generated-
// date), so the header row's position isn't fixed — locate it by content
// (must contain a "Service Date" column) rather than a hardcoded row number.
function findHeaderRow(sheet) {
  const maxScan = Math.min(sheet.rowCount, 20);
  for (let r = 1; r <= maxScan; r++) {
    const row = sheet.getRow(r);
    const values = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (typeof v === 'string' && v.trim()) values.push(v.trim());
    });
    if (values.some((v) => norm(v) === 'service date')) {
      return { rowNumber: r, headers: values };
    }
  }
  return null;
}

// Excel time-only cells (no real calendar date) round-trip through ExcelJS
// as a UTC-anchored Date whose UTC hour/minute IS the literal spreadsheet
// value (verified against a real export: Start Time 07:05/End Time 08:05
// round-trip with a 1-hour Service Time duration only when read via
// getUTCHours/getUTCMinutes — reading via local-timezone getters shifts the
// value by the runtime's UTC offset and silently corrupts every time).
function excelTimeToHHMM(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

function excelDateToISO(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

// State exports don't guarantee identical Child ID formatting run to run
// (case, stray whitespace, hyphens, or other punctuation a state system
// might include) — strip everything but letters/digits before comparing so
// a cosmetic formatting difference doesn't silently zero out a match.
function normalizeChildId(value) {
  return (value || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cellToText(value) {
  if (value == null) return null;
  if (value instanceof Date) return null;
  if (typeof value === 'object' && value.richText) return value.richText.map((t) => t.text).join('').trim() || null;
  const s = String(value).trim();
  return s || null;
}

// Like cellToText, but for a Total Time-style custom field: a duration cell
// can round-trip through ExcelJS as a UTC-anchored Date the same way a
// time-of-day cell does (see excelTimeToHHMM above), which cellToText would
// otherwise null out. Formats it as "H:MM" text so it survives storage and
// parseDurationMinutes (billingController.js) can parse it back out later.
function cellToDurationText(value) {
  if (value == null) return null;
  if (value instanceof Date) return `${value.getUTCHours()}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  return cellToText(value);
}

// Reads the "Begin and End Dates: MM/DD/YYYY - MM/DD/YYYY" line the state
// puts near the top of the export, if present — purely informational
// (stored alongside each parsed row), parsing never depends on it.
function extractPeriod(sheet) {
  for (let r = 1; r <= Math.min(sheet.rowCount, 5); r++) {
    const text = cellToText(sheet.getRow(r).getCell(1).value);
    const match = text && text.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
    if (match) {
      const toIso = (mdY) => { const [m, d, y] = mdY.split('/'); return `${y}-${m}-${d}`; };
      return { periodStart: toIso(match[1]), periodEnd: toIso(match[2]) };
    }
  }
  return { periodStart: null, periodEnd: null };
}

async function readWorkbookFromBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

async function buildMappingResponse(buffer, previousMapping, previousCustomFields, removedFieldKeys) {
  const sheet = await readWorkbookFromBuffer(buffer);
  const found = findHeaderRow(sheet);
  if (!found) {
    return { error: 'Could not find a header row containing "Service Date" in this file.' };
  }
  const { rowNumber, headers } = found;
  const suggestedMapping = suggestMapping(headers);
  // Custom fields the user added previously are only carried forward if
  // their chosen header still exists in this file — same "don't silently
  // mis-map" principle as the fixed fields' changed/needs-input flagging.
  const carriedCustomFields = (previousCustomFields || []).filter((cf) => headers.includes(cf.header));
  // Fields explicitly removed on a prior confirm stay removed — otherwise
  // they'd just get auto-re-detected from the file's headers every time
  // this screen reopens, making "delete" look like it did nothing.
  const removedSet = new Set(removedFieldKeys || []);
  const visibleTargetFields = TARGET_FIELDS.filter((f) => !removedSet.has(f.key));
  return {
    headers,
    targetFields: visibleTargetFields,
    suggestedMapping,
    previousMapping: previousMapping || null,
    previousCustomFields: carriedCustomFields,
    removedFields: [...removedSet],
    rowCount: sheet.rowCount - rowNumber,
  };
}

const uploadComplianceDoc = async (req, res) => {
  const { filename, fileBase64 } = req.body;
  try {
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'filename is required' });
    }
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (!COMPLIANCE_DOC_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: 'Only .xlsx or .xls files are supported' });
    }
    if (typeof fileBase64 !== 'string' || !fileBase64.includes(',')) {
      return res.status(400).json({ error: 'fileBase64 must be a data: URL' });
    }
    if (fileBase64.length > MAX_COMPLIANCE_DOC_BASE64_LENGTH) {
      return res.status(400).json({ error: 'File is too large — please use a file under 10MB.' });
    }

    const base64Data = fileBase64.slice(fileBase64.indexOf(',') + 1);
    const buffer = Buffer.from(base64Data, 'base64');

    const { rows: existingBeforeUpload } = await pool.query('SELECT compliance_doc_path, compliance_doc_column_mapping, compliance_doc_custom_fields, compliance_doc_removed_fields FROM company_settings WHERE id = 1');
    const previousMapping = existingBeforeUpload[0]?.compliance_doc_column_mapping || null;
    const previousCustomFields = existingBeforeUpload[0]?.compliance_doc_custom_fields || [];
    const removedFieldKeys = existingBeforeUpload[0]?.compliance_doc_removed_fields || [];

    const mappingInfo = await buildMappingResponse(buffer, previousMapping, previousCustomFields, removedFieldKeys);
    if (mappingInfo.error) return res.status(400).json(mappingInfo);

    const path = `${COMPLIANCE_DOC_PREFIX}${Date.now()}-${filename}`;
    const contentType = ext === '.xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.ms-excel';

    const previousPath = existingBeforeUpload[0]?.compliance_doc_path;

    await uploadFile(NJEIS_FORMS_BUCKET, path, buffer, contentType);

    // Column mapping and compliance_state_logs are deliberately left alone
    // here — they only get (re)written once the user confirms the mapping
    // via applyComplianceDocMapping, so an in-progress upload never leaves
    // Compliance Analysis pointing at a half-parsed document.
    const { rows } = await pool.query(
      `INSERT INTO company_settings (id, compliance_doc_path, compliance_doc_filename, compliance_doc_size, compliance_doc_uploaded_at, updated_at)
       VALUES (1, $1, $2, $3, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         compliance_doc_path = EXCLUDED.compliance_doc_path,
         compliance_doc_filename = EXCLUDED.compliance_doc_filename,
         compliance_doc_size = EXCLUDED.compliance_doc_size,
         compliance_doc_uploaded_at = EXCLUDED.compliance_doc_uploaded_at,
         updated_at = now()
       RETURNING *`,
      [path, filename, buffer.length]
    );

    if (previousPath && previousPath !== path) {
      await removeFiles(NJEIS_FORMS_BUCKET, [previousPath]).catch(() => {});
    }

    logAudit({ req, action: 'compliance_doc_upload', resourceType: 'compliance_doc', resourceId: path, details: { filename } });
    res.json({ success: true, settings: rows[0], ...mappingInfo });
  } catch (error) {
    console.error('Error uploading compliance document:', error);
    res.status(500).json({ error: 'Failed to upload compliance document' });
  }
};

// Re-reads the currently-stored file's headers without re-uploading — lets
// Company Information reopen the mapping screen later (e.g. to fix a field
// that was left unmapped, or to re-check after the state changes their
// export layout) without requiring a fresh upload.
const getComplianceDocMapping = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT compliance_doc_path, compliance_doc_column_mapping, compliance_doc_custom_fields, compliance_doc_removed_fields FROM company_settings WHERE id = 1');
    const path = rows[0]?.compliance_doc_path;
    if (!path) return res.status(404).json({ error: 'No compliance document on file' });

    const buffer = await downloadFile(NJEIS_FORMS_BUCKET, path);
    const mappingInfo = await buildMappingResponse(
      buffer,
      rows[0]?.compliance_doc_column_mapping || null,
      rows[0]?.compliance_doc_custom_fields || [],
      rows[0]?.compliance_doc_removed_fields || []
    );
    if (mappingInfo.error) return res.status(400).json(mappingInfo);

    res.json({ success: true, ...mappingInfo });
  } catch (error) {
    console.error('Error reading compliance document mapping:', error);
    res.status(500).json({ error: 'Failed to read compliance document' });
  }
};

// Applies a confirmed column mapping: re-parses the whole file with it,
// replaces compliance_state_logs entirely (single active document, no
// history — see schema.sql), and saves the mapping so next upload's
// suggested/previous-mapping diff can flag anything that changed.
const applyComplianceDocMapping = async (req, res) => {
  const { mapping, customFields: rawCustomFields, removedFields: rawRemovedFields } = req.body;
  try {
    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({ error: 'mapping is required' });
    }
    // Fields the user removed on the mapping screen — persisted so they stay
    // gone on the next reopen instead of getting auto-re-detected from the
    // file's headers every time (that made "delete" look like a no-op).
    const removedFields = Array.isArray(rawRemovedFields)
      ? [...new Set(rawRemovedFields.filter((k) => typeof k === 'string'))].filter((k) => !TARGET_FIELDS.find((f) => f.key === k)?.required)
      : [];
    const requiredMissing = TARGET_FIELDS.filter((f) => f.required && !mapping[f.key]);
    if (requiredMissing.length > 0) {
      return res.status(400).json({ error: `Missing required field mapping(s): ${requiredMissing.map((f) => f.label).join(', ')}` });
    }
    // Extra state-side-only fields the user added beyond the fixed 11 —
    // stored per row in compliance_state_logs.extra_fields, shown in
    // Compliance Analysis as informational by default. Optionally tied to
    // one of our real comparable fields (compareTo) to get a genuine
    // match/mismatch verdict instead — see getComplianceAnalysis.
    const VALID_CUSTOM_FIELD_COMPARE_TO = [
      'service_type', 'location', 'group_size',
      'service_status', 'total_time', 'practitioner_discipline', 'patient_dob', 'patient_county',
    ];
    // A company's own custom dropdown categories are also valid compareTo
    // targets (custom_category:<key>) alongside the fixed 8 above — checked
    // dynamically against the DB rather than a static array, since custom
    // categories are per-tenant and created/removed at runtime.
    const { rows: customCategoryRows } = await pool.query(
      'SELECT key FROM dropdown_categories WHERE is_custom = true AND is_active = true'
    );
    const validCustomCategoryCompareTos = customCategoryRows.map((r) => `custom_category:${r.key}`);
    const isValidCompareTo = (value) =>
      VALID_CUSTOM_FIELD_COMPARE_TO.includes(value) || validCustomCategoryCompareTos.includes(value);
    const customFields = Array.isArray(rawCustomFields)
      ? rawCustomFields.filter((cf) => cf && cf.label && cf.header).map((cf) => ({
          label: String(cf.label).trim(),
          header: String(cf.header),
          compareTo: isValidCompareTo(cf.compareTo) ? cf.compareTo : null,
        }))
      : [];

    const { rows: settingsRows } = await pool.query('SELECT compliance_doc_path FROM company_settings WHERE id = 1');
    const path = settingsRows[0]?.compliance_doc_path;
    if (!path) return res.status(404).json({ error: 'No compliance document on file' });

    const buffer = await downloadFile(NJEIS_FORMS_BUCKET, path);
    const sheet = await readWorkbookFromBuffer(buffer);
    const found = findHeaderRow(sheet);
    if (!found) return res.status(400).json({ error: 'Could not find a header row containing "Service Date" in this file.' });
    const { rowNumber: headerRow, headers } = found;
    const { periodStart, periodEnd } = extractPeriod(sheet);

    const colIndex = {};
    for (const field of TARGET_FIELDS) {
      const header = mapping[field.key];
      colIndex[field.key] = header ? headers.indexOf(header) + 1 : 0; // 0 = not mapped
    }
    const customColIndex = customFields.map((cf) => ({ label: cf.label, col: headers.indexOf(cf.header) + 1, compareTo: cf.compareTo || null }));

    // Resolve every referenced Child ID to our patients table in one query,
    // instead of one lookup per row. Matched on a normalized form (case +
    // stray whitespace stripped) rather than exact equality — a new state
    // export can format the same ID slightly differently (e.g. "nj12345 "
    // vs "NJ12345") from month to month, and an exact-string match would
    // silently break every row when that happens.
    const childIds = new Set();
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const v = colIndex.child_id ? cellToText(sheet.getRow(r).getCell(colIndex.child_id).value) : null;
      if (v) childIds.add(normalizeChildId(v));
    }
    const { rows: patientRows } = childIds.size
      ? await pool.query(
          `SELECT id, child_id, UPPER(REGEXP_REPLACE(child_id, '[^A-Za-z0-9]', '', 'g')) AS norm_child_id
           FROM patients WHERE UPPER(REGEXP_REPLACE(child_id, '[^A-Za-z0-9]', '', 'g')) = ANY($1)`,
          [[...childIds]]
        )
      : { rows: [] };
    // A Child ID isn't guaranteed unique in patients (e.g. duplicate patient
    // records from a name-spelling typo, or the same child intentionally
    // re-entered). Collapsing to a single winner here meant every duplicate
    // OTHER than the one that happened to win silently never got a state-log
    // match — sessions logged against it always read "Missing in EIMS" even
    // when a real match was on file, just linked to a sibling patient row.
    // Keep every matching patient so each duplicate gets its own linked copy.
    const patientIdsByChildId = new Map();
    for (const p of patientRows) {
      if (!patientIdsByChildId.has(p.norm_child_id)) patientIdsByChildId.set(p.norm_child_id, []);
      patientIdsByChildId.get(p.norm_child_id).push(p.id);
    }

    const parsedRows = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const get = (key) => (colIndex[key] ? row.getCell(colIndex[key]).value : null);
      const childId = colIndex.child_id ? cellToText(get('child_id')) : null;
      const serviceDate = colIndex.service_date ? excelDateToISO(get('service_date')) : null;
      if (!childId || !serviceDate) continue; // rows missing either required field aren't usable for matching

      const serviceLabel = cellToText(get('service_label'));
      const locationLabel = cellToText(get('location_label'));
      const groupSizeLabel = cellToText(get('group_size_label'));

      let extraFields = null;
      if (customColIndex.length > 0) {
        const obj = {};
        for (const cf of customColIndex) {
          if (!cf.col) continue;
          const cellValue = row.getCell(cf.col).value;
          // Most compareTo types are plain text/codes — cellToText is fine.
          // Two need special extraction because their raw Excel cell type
          // (a real date, or a duration cell round-tripping as a Date the
          // same way time-of-day cells do) would otherwise get nulled out.
          if (cf.compareTo === 'patient_dob') obj[cf.label] = excelDateToISO(cellValue);
          else if (cf.compareTo === 'total_time') obj[cf.label] = cellToDurationText(cellValue);
          else obj[cf.label] = cellToText(cellValue);
        }
        extraFields = Object.keys(obj).length > 0 ? obj : null;
      }

      const matchingPatientIds = patientIdsByChildId.get(normalizeChildId(childId)) || [null];
      const restOfRow = [
        childId,
        cellToText(get('child_name')),
        cellToText(get('practitioner_name')),
        serviceLabel,
        null, // service_type_label — reserved, not separately mapped today
        groupSizeLabel,
        locationLabel,
        serviceDate,
        excelTimeToHHMM(get('start_time')),
        excelTimeToHHMM(get('end_time')),
        null, // service_minutes — derivable from start/end, not separately stored today
        colIndex.logged_date ? excelDateToISO(get('logged_date')) : null,
        cellToText(get('ifsp_event_id')),
        mapServiceLabelToCode(serviceLabel),
        mapLocationLabelToCode(locationLabel),
        mapGroupSizeLabelToCode(groupSizeLabel),
        periodStart,
        periodEnd,
        extraFields ? JSON.stringify(extraFields) : null,
      ];
      // One row per matching patient — see patientIdsByChildId above.
      for (const patientId of matchingPatientIds) {
        parsedRows.push([patientId, ...restOfRow]);
      }
    }

    // Uploads happen roughly monthly, and a biller may still be reviewing an
    // older still-open billing period — so a new upload must ADD its
    // coverage rather than wiping the whole table. Only this file's own
    // date range gets cleared (avoids duplicates if the same month is
    // re-uploaded), then anything older than the 120-day retention floor is
    // purged. This purge is scoped to compliance_state_logs only — never
    // touches assessments/patients/billing data, which are retained forever.
    const serviceDates = parsedRows.map((r) => r[8]).filter(Boolean);
    const minDate = serviceDates.length ? serviceDates.reduce((a, b) => (a < b ? a : b)) : null;
    const maxDate = serviceDates.length ? serviceDates.reduce((a, b) => (a > b ? a : b)) : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (minDate && maxDate) {
        await client.query('DELETE FROM compliance_state_logs WHERE service_date BETWEEN $1 AND $2', [minDate, maxDate]);
      }
      await client.query("DELETE FROM compliance_state_logs WHERE service_date < CURRENT_DATE - INTERVAL '120 days'");
      for (const row of parsedRows) {
        await client.query(
          `INSERT INTO compliance_state_logs
             (patient_id, child_id, child_name, practitioner_name, service_label, service_type_label,
              group_size_label, location_label, service_date, start_time, end_time, service_minutes,
              logged_date, ifsp_event_id, mapped_service_code, mapped_location_code, mapped_group_size_code,
              period_start, period_end, extra_fields)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          row
        );
      }

      // Month-by-month snapshot of what's now on file — a frozen point-in-time
      // read, not a live view, so it stays on screen exactly as-is (per the
      // 120-day purge above continuing to run silently in the background)
      // until the next upload replaces it, or Refresh is clicked. Surfaces
      // the actual current data coverage, which the retention copy alone
      // doesn't show anyone.
      const complianceDocAnalysis = await computeComplianceDocAnalysis(client);

      await client.query(
        `UPDATE company_settings SET compliance_doc_column_mapping = $1, compliance_doc_custom_fields = $2, compliance_doc_removed_fields = $3, compliance_doc_applied_path = $4, compliance_doc_analysis = $5, updated_at = now() WHERE id = 1`,
        [JSON.stringify(mapping), JSON.stringify(customFields), JSON.stringify(removedFields), path, JSON.stringify(complianceDocAnalysis)]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const matchedPatients = parsedRows.filter((r) => r[0] !== null).length;
    logAudit({
      req, action: 'compliance_doc_apply_mapping', resourceType: 'compliance_doc', resourceId: path,
      details: { rowsParsed: parsedRows.length, matchedPatients },
    });
    res.json({
      success: true,
      rowsParsed: parsedRows.length,
      matchedPatients,
      unmatchedCount: parsedRows.length - matchedPatients,
    });
  } catch (error) {
    console.error('Error applying compliance document mapping:', error);
    res.status(500).json({ error: 'Failed to apply column mapping' });
  }
};

const removeComplianceDoc = async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT compliance_doc_path FROM company_settings WHERE id = 1');
    const path = existing[0]?.compliance_doc_path;

    const { rows } = await pool.query(
      `UPDATE company_settings SET
         compliance_doc_path = NULL,
         compliance_doc_filename = NULL,
         compliance_doc_size = NULL,
         compliance_doc_uploaded_at = NULL,
         compliance_doc_column_mapping = NULL,
         compliance_doc_custom_fields = '[]',
         compliance_doc_removed_fields = '[]',
         compliance_doc_applied_path = NULL,
         compliance_doc_analysis = NULL,
         updated_at = now()
       WHERE id = 1
       RETURNING *`
    );

    if (path) await removeFiles(NJEIS_FORMS_BUCKET, [path]).catch(() => {});
    await pool.query('DELETE FROM compliance_state_logs');

    logAudit({ req, action: 'compliance_doc_remove', resourceType: 'compliance_doc', resourceId: path || null });
    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error removing compliance document:', error);
    res.status(500).json({ error: 'Failed to remove compliance document' });
  }
};

// Recomputes and re-stores the month-by-month snapshot on demand, without
// touching the file/mapping/120-day purge — covers a doc that was applied
// before this feature existed (so compliance_doc_analysis is still NULL),
// and lets an admin manually re-sync the frozen table against the
// background purge without waiting for the next Replace.
const refreshComplianceDocAnalysis = async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT compliance_doc_applied_path FROM company_settings WHERE id = 1');
    if (!existing[0]?.compliance_doc_applied_path) {
      return res.status(404).json({ error: 'No confirmed compliance document on file to summarize' });
    }

    const complianceDocAnalysis = await computeComplianceDocAnalysis(pool);
    const { rows } = await pool.query(
      `UPDATE company_settings SET compliance_doc_analysis = $1, updated_at = now() WHERE id = 1 RETURNING *`,
      [JSON.stringify(complianceDocAnalysis)]
    );

    logAudit({ req, action: 'compliance_doc_refresh_analysis', resourceType: 'compliance_doc', resourceId: null });
    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error refreshing compliance document analysis:', error);
    res.status(500).json({ error: 'Failed to refresh data summary' });
  }
};

const getComplianceDocDownloadUrl = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT compliance_doc_path FROM company_settings WHERE id = 1');
    const path = rows[0]?.compliance_doc_path;
    if (!path) return res.status(404).json({ error: 'No compliance document on file' });

    const signedUrl = await getSignedUrl(NJEIS_FORMS_BUCKET, path, 300); // short-lived, single-click download
    logAudit({ req, action: 'compliance_doc_download', resourceType: 'compliance_doc', resourceId: path });
    res.json({ success: true, url: signedUrl });
  } catch (error) {
    console.error('Error generating compliance document download URL:', error);
    res.status(500).json({ error: 'Failed to generate download link' });
  }
};

// Deletes only one month's rows out of compliance_state_logs — a narrower
// version of removeComplianceDoc's full wipe, for a user who wants to
// discard just one bad/stale month rather than starting over completely.
// Recomputes and re-stores compliance_doc_analysis in the same request so
// the "Data currently on file" table reflects the deletion immediately,
// same as refreshComplianceDocAnalysis does after a Refresh click.
const deleteComplianceMonthData = async (req, res) => {
  const { month } = req.params; // 'YYYY-MM'
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'A valid month (YYYY-MM) is required' });
  }

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM compliance_state_logs WHERE to_char(service_date, 'YYYY-MM') = $1`,
      [month]
    );

    const complianceDocAnalysis = await computeComplianceDocAnalysis(pool);
    const { rows } = await pool.query(
      `UPDATE company_settings SET compliance_doc_analysis = $1, updated_at = now() WHERE id = 1 RETURNING *`,
      [JSON.stringify(complianceDocAnalysis)]
    );

    logAudit({ req, action: 'compliance_doc_delete_month', resourceType: 'compliance_doc', resourceId: month, details: { month, deletedCount: rowCount } });
    res.json({ success: true, deletedCount: rowCount, settings: rows[0] });
  } catch (error) {
    console.error('Error deleting compliance month data:', error);
    res.status(500).json({ error: 'Failed to delete month data' });
  }
};

// Exports the compliance_state_logs rows for one month bucket from the
// "Data currently on file" table as an Excel workbook — lets a user pull
// back out exactly what's currently on file for a given month within the
// rolling 120-day window, independent of whichever raw upload(s) produced it
// (a month's data can span more than one upload once older files purge).
// Same live 120-day filter as computeComplianceDocAnalysis above, so this
// always exports exactly what the displayed record_count says it will —
// see that function's comment for why a live filter (not just "whatever's
// physically in the table") is needed here.
const downloadComplianceMonthData = async (req, res) => {
  const { month } = req.query; // 'YYYY-MM'
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'A valid month (YYYY-MM) is required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT child_id, child_name, practitioner_name, service_date, start_time, end_time,
              service_label, location_label, group_size_label, logged_date, ifsp_event_id
       FROM compliance_state_logs
       WHERE to_char(service_date, 'YYYY-MM') = $1
         AND service_date >= CURRENT_DATE - INTERVAL '120 days'
       ORDER BY service_date ASC, child_name ASC`,
      [month]
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(month);
    sheet.columns = [
      { header: 'Child ID', key: 'child_id', width: 16 },
      { header: 'Child Name', key: 'child_name', width: 24 },
      { header: 'Practitioner', key: 'practitioner_name', width: 24 },
      { header: 'Service Date', key: 'service_date', width: 14 },
      { header: 'Start Time', key: 'start_time', width: 12 },
      { header: 'End Time', key: 'end_time', width: 12 },
      { header: 'Service', key: 'service_label', width: 26 },
      { header: 'Location', key: 'location_label', width: 22 },
      { header: 'Group Size', key: 'group_size_label', width: 26 },
      { header: 'Logged Date', key: 'logged_date', width: 14 },
      { header: 'IFSP Event ID', key: 'ifsp_event_id', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row);

    const buffer = await workbook.xlsx.writeBuffer();

    logAudit({ req, action: 'compliance_month_data_download', resourceType: 'compliance_doc', details: { month, recordCount: rows.length } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="compliance-data-${month}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error generating compliance month data export:', error);
    res.status(500).json({ error: 'Failed to generate month data export' });
  }
};

module.exports = {
  getCompanySettings,
  getCompanyBranding,
  updateCompanySettings,
  updateCompanyLogo,
  uploadComplianceDoc,
  getComplianceDocMapping,
  applyComplianceDocMapping,
  removeComplianceDoc,
  refreshComplianceDocAnalysis,
  getComplianceDocDownloadUrl,
  downloadComplianceMonthData,
  deleteComplianceMonthData,
};
