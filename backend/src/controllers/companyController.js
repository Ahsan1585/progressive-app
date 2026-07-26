const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const { NJEIS_FORMS_BUCKET, uploadFile, downloadFile, getSignedUrl, removeFiles } = require('../config/storage');
const { TARGET_FIELDS, suggestMapping, norm } = require('../constants/complianceMapping');
const { mapServiceLabelToCode, mapLocationLabelToCode, mapGroupSizeLabelToCode } = require('../constants/njeis');

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

const getCompanySettings = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM company_settings WHERE id = 1');
    res.json({ success: true, settings: rows[0] || null });
  } catch (error) {
    console.error('Error fetching company settings:', error);
    res.status(500).json({ error: 'Failed to fetch company settings' });
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
// (case, stray leading/trailing/internal whitespace) — normalize before
// comparing so a cosmetic difference doesn't silently zero out every match.
function normalizeChildId(value) {
  return (value || '').toString().trim().toUpperCase().replace(/\s+/g, '');
}

function cellToText(value) {
  if (value == null) return null;
  if (value instanceof Date) return null;
  if (typeof value === 'object' && value.richText) return value.richText.map((t) => t.text).join('').trim() || null;
  const s = String(value).trim();
  return s || null;
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
    // Compliance Analysis as informational (no "our side" to compare
    // against, so never a match/mismatch verdict — see getComplianceAnalysis).
    const customFields = Array.isArray(rawCustomFields)
      ? rawCustomFields.filter((cf) => cf && cf.label && cf.header).map((cf) => ({ label: String(cf.label).trim(), header: String(cf.header) }))
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
    const customColIndex = customFields.map((cf) => ({ label: cf.label, col: headers.indexOf(cf.header) + 1 }));

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
          `SELECT id, child_id, UPPER(REGEXP_REPLACE(child_id, '\\s+', '', 'g')) AS norm_child_id
           FROM patients WHERE UPPER(REGEXP_REPLACE(child_id, '\\s+', '', 'g')) = ANY($1)`,
          [[...childIds]]
        )
      : { rows: [] };
    const patientIdByChildId = new Map(patientRows.map((p) => [p.norm_child_id, p.id]));

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
          if (cf.col) obj[cf.label] = cellToText(row.getCell(cf.col).value);
        }
        extraFields = Object.keys(obj).length > 0 ? obj : null;
      }

      parsedRows.push([
        patientIdByChildId.get(normalizeChildId(childId)) || null,
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
      ]);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM compliance_state_logs');
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
      await client.query(
        `UPDATE company_settings SET compliance_doc_column_mapping = $1, compliance_doc_custom_fields = $2, compliance_doc_removed_fields = $3, compliance_doc_applied_path = $4, updated_at = now() WHERE id = 1`,
        [JSON.stringify(mapping), JSON.stringify(customFields), JSON.stringify(removedFields), path]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const matchedPatients = parsedRows.filter((r) => r[0] !== null).length;
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
         updated_at = now()
       WHERE id = 1
       RETURNING *`
    );

    if (path) await removeFiles(NJEIS_FORMS_BUCKET, [path]).catch(() => {});
    await pool.query('DELETE FROM compliance_state_logs');

    res.json({ success: true, settings: rows[0] });
  } catch (error) {
    console.error('Error removing compliance document:', error);
    res.status(500).json({ error: 'Failed to remove compliance document' });
  }
};

const getComplianceDocDownloadUrl = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT compliance_doc_path FROM company_settings WHERE id = 1');
    const path = rows[0]?.compliance_doc_path;
    if (!path) return res.status(404).json({ error: 'No compliance document on file' });

    const signedUrl = await getSignedUrl(NJEIS_FORMS_BUCKET, path, 300); // short-lived, single-click download
    res.json({ success: true, url: signedUrl });
  } catch (error) {
    console.error('Error generating compliance document download URL:', error);
    res.status(500).json({ error: 'Failed to generate download link' });
  }
};

module.exports = {
  getCompanySettings,
  updateCompanySettings,
  updateCompanyLogo,
  uploadComplianceDoc,
  getComplianceDocMapping,
  applyComplianceDocMapping,
  removeComplianceDoc,
  getComplianceDocDownloadUrl,
};
