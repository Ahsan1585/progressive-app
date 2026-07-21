const { pool } = require('../config/db');
const {
  BILLING_INVOICES_BUCKET,
  uploadFile,
  downloadFile,
  getSignedUrl,
  removeFiles,
  listFilesDetailed,
} = require('../config/storage');
const { generateInvoicePDF } = require('../utils/invoiceGenerator');
const { stampInvoicePaid } = require('../utils/invoiceStamper');
const { getDisciplineCode } = require('../utils/disciplineCodes');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// --- 1. NEW Standardized Path Helper ---
const getStoragePath = (practitioner, type) => {
  const date = new Date();
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const name = `${practitioner.first_name}_${practitioner.last_name}`.replace(/\s+/g, '_');
  // Folder structure: YYYY-MM / PractitionerName / Type.pdf
  return `${yearMonth}/${name}/${type}.pdf`;
};

// --- 2. Fetch Logs (ONLY ACTIVE ONES) ---
const getPendingLogs = async (req, res) => {
  const { search, startDate, endDate } = req.query;

  try {
    const params = [['pending', 'njeis_review', 'on_hold']];
    let sql = `
      SELECT a.*, p.first_name AS practitioner_live_first_name, p.last_name AS practitioner_live_last_name
      FROM assessments a
      JOIN practitioners p ON p.id = a.practitioner_id
      WHERE a.billing_status = ANY($1::text[])
    `;
    if (startDate) { params.push(startDate); sql += ` AND a.service_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND a.service_date <= $${params.length}`; }

    const { rows: assessments } = await pool.query(sql, params);

    // Non-fatal: billing_locks may not exist yet on an environment that hasn't
    // run the migration — fall back to "nothing locked" rather than breaking
    // the whole Pending Bills list over it.
    const lockMap = {};
    try {
      const { rows: lockRows } = await pool.query(`
        SELECT bl.practitioner_id, bl.locked_by, p.first_name, p.last_name
        FROM billing_locks bl
        JOIN practitioners p ON p.id = bl.locked_by
      `);
      lockRows.forEach(l => {
        lockMap[l.practitioner_id] = { locked_by_id: l.locked_by, locked_by_name: `${l.first_name} ${l.last_name}` };
      });
    } catch (lockError) {
      console.warn('getPendingLogs: billing_locks lookup failed (continuing without lock info):', lockError.message);
    }

    const practitionerMap = {};
    // Logs placed on hold are aggregated into a completely separate summary
    // row per practitioner — set aside from their regular billing queue so
    // they don't block or get mixed into that practitioner's normal SEVF/
    // invoice generation until someone reviews and releases them.
    const holdMap = {};

    assessments.forEach(record => {
      const pId = record.practitioner_id;
      const targetMap = record.billing_status === 'on_hold' ? holdMap : practitionerMap;

      if (!targetMap[pId]) {
        targetMap[pId] = {
          practitioner_id: pId,
          first_name: record.practitioner_live_first_name || 'Unknown',
          last_name: record.practitioner_live_last_name || 'Unknown',
          total_interventions: 0,
          unique_children: new Set(),
          total_hours: 0,
          workflow_status: record.billing_status === 'on_hold' ? 'hold' : 'njeis_review',
          group_type: record.billing_status === 'on_hold' ? 'hold' : 'pending',
          locked_by_id: lockMap[pId]?.locked_by_id || null,
          locked_by_name: lockMap[pId]?.locked_by_name || null,
        };
      }

      if (record.billing_status === 'pending') {
        targetMap[pId].workflow_status = 'pending';
      }

      targetMap[pId].total_interventions += 1;
      targetMap[pId].unique_children.add(record.patient_id);

      const hours = record.total_time ? (record.total_time / 60) : 0;
      targetMap[pId].total_hours += hours;
    });

    // 🌟 FIX: Use the new folder helper to resolve URLs
    const logs = await Promise.all([...Object.values(practitionerMap), ...Object.values(holdMap)].map(async log => {
      let njeis_url = null;
      if (log.workflow_status === 'njeis_review') {
        const d = new Date();
        const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const practName = `${log.first_name}_${log.last_name}`.replace(/\s+/g, '_');
        const folderPath = `${yearMonth}/${practName}`;
        const folderItems = await listFilesDetailed(BILLING_INVOICES_BUCKET, `${folderPath}/`);
        const njeisItems = folderItems
          .filter(f => path.basename(f.name).startsWith('NJEIS'))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const latestNjeis = njeisItems[0];
        if (latestNjeis) {
          njeis_url = await getSignedUrl(BILLING_INVOICES_BUCKET, latestNjeis.name, 3600);
        }
      }

      return {
        ...log,
        unique_children_count: log.unique_children.size,
        unique_children: undefined,
        njeis_url,
        invoice_url: null
      };
    }));

    // Keep practitioners grouped together alphabetically, with each
    // practitioner's Hold row (if any) directly beneath their regular row.
    logs.sort((a, b) => {
      const nameCompare = `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
      if (nameCompare !== 0) return nameCompare;
      if (a.practitioner_id !== b.practitioner_id) return a.practitioner_id - b.practitioner_id;
      return (a.group_type === 'hold' ? 1 : 0) - (b.group_type === 'hold' ? 1 : 0);
    });

    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
};

// --- 3. STEP 1: Generate Master NJEIS Forms ---
const generateNJEISForms = async (req, res) => {
  const { practitionerId, startDate, endDate, excludedIds = [] } = req.body;

  try {
    const params = [practitionerId, ['pending']];
    let sql = `
      SELECT a.*, to_jsonb(p) AS practitioners, to_jsonb(pt) AS patients
      FROM assessments a
      JOIN practitioners p ON p.id = a.practitioner_id
      LEFT JOIN patients pt ON pt.id = a.patient_id
      WHERE a.practitioner_id = $1 AND a.billing_status = ANY($2::text[])
    `;
    if (startDate) { params.push(startDate); sql += ` AND a.service_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND a.service_date <= $${params.length}`; }
    sql += ' ORDER BY a.service_date ASC';

    const { rows: assessments } = await pool.query(sql, params);
    if (!assessments || assessments.length === 0) return res.status(400).json({ success: false, error: "No pending assessments found." });

    const practitioner = assessments[0].practitioners;
    const filteredAssessments = excludedIds.length > 0
      ? assessments.filter(a => !excludedIds.includes(a.id))
      : assessments;
    if (filteredAssessments.length === 0) return res.status(400).json({ success: false, error: "No assessments remaining after exclusions." });

    const allAssessmentIds = filteredAssessments.map(a => a.id);
    const groupedByPatient = filteredAssessments.reduce((acc, record) => {
      if (!acc[record.patient_id]) acc[record.patient_id] = [];
      acc[record.patient_id].push(record);
      return acc;
    }, {});

    const templatePath = path.join(__dirname, '..', '..', 'templates', 'NJEIS-020.pdf');
    const templateBytes = fs.readFileSync(templatePath);
    const finalNjeisPdf = await PDFDocument.create();

    for (const patientId of Object.keys(groupedByPatient)) {
      const patientRecords = groupedByPatient[patientId];
      for (let i = 0; i < patientRecords.length; i += 10) {
        const chunk = patientRecords.slice(i, i + 10);
        const pData = chunk[0];

        const tempDoc = await PDFDocument.load(templateBytes);
        const form = tempDoc.getForm();
        const setUniformText = (fieldName, text) => {
          try {
            const field = form.getTextField(fieldName);
            field.setText(text || '');
            field.setFontSize(10);
          } catch (e) { }
        };

        setUniformText('Service Provider Agency Name', 'Progressive Steps');
        setUniformText('Practitioner Last Name', pData.practitioner_last_name);
        setUniformText('Practitioner First Name', pData.practitioner_first_name);
        setUniformText('Childs Last Name', pData.patient_last_name);
        setUniformText('Childs First Name', pData.patient_first_name);
        if (pData.patient_dob) {
          const [by, bm, bd] = pData.patient_dob.split('-');
          setUniformText('DOB', `${parseInt(bm)}/${parseInt(bd)}/${by}`);
        } else {
          setUniformText('DOB', '');
        }
        // County is a dropdown in the template — capture its rect now, draw plain text after flatten
        const countyValue = pData.patients?.county || pData.patient_county || '';
        let countyRect = null;
        try {
          countyRect = form.getField('County').acroField.getWidgets()[0].getRectangle();
        } catch (e) {
          setUniformText('County', countyValue); // fallback if it is a plain text field
        }
        setUniformText('Child ID', pData.patients?.child_id || pData.patient_id?.toString());
        setUniformText('DisciplinePosition Title', getDisciplineCode(practitioner.position_title));
        if (pData.service_date) {
          const [my, mm] = pData.service_date.split('-');
          setUniformText('MonthYear', `${mm}/${my}`);
        }

        chunk.forEach((session, index) => {
          const rowNum = index + 1;
          const [sy, sm, sd] = (session.service_date || '').split('-');
          setUniformText(`Service date${rowNum}`, session.service_date ? `${parseInt(sm)}/${parseInt(sd)}/${sy.slice(-2)}` : '');
          setUniformText(`Service StatusRow${rowNum}`, session.status?.toString());
          setUniformText(`Service TypeRow${rowNum}`, session.type);
          setUniformText(`Service LocationRow${rowNum}`, session.location?.toString());
          setUniformText(`Start TimeRow${rowNum}`, session.start_time);
          setUniformText(`End TimeRow${rowNum}`, session.end_time);
          setUniformText(`Total TimeRow${rowNum}`, session.total_time?.toString());
        });

        setUniformText('Date', new Date().toLocaleDateString());
        const pages = tempDoc.getPages();
        const firstPage = pages[0];

        if (pData.practitioner_signature) {
          const practSigImage = await tempDoc.embedPng(pData.practitioner_signature);
          firstPage.drawImage(practSigImage, { x: 40, y: 302, width: practSigImage.scale(0.25).width, height: practSigImage.scale(0.25).height });
        }
        for (let index = 0; index < chunk.length; index++) {
          const rowNum = index + 1;
          if (chunk[index].billing_status === 'rejected') {
            setUniformText(`ParentCaregiver Signature Verifying Services ReceivedRow${rowNum}`, 'REJECTED');
          } else if (chunk[index].parent_signature) {
            try {
              const sigField = form.getTextField(`ParentCaregiver Signature Verifying Services ReceivedRow${rowNum}`);
              const rect = sigField.acroField.getWidgets()[0].getRectangle();
              const parentSigImage = await tempDoc.embedPng(chunk[index].parent_signature);
              const padding = 2;
              const maxW = rect.width - padding * 2;
              const maxH = rect.height - padding * 2;
              const scale = Math.min(maxW / parentSigImage.width, maxH / parentSigImage.height);
              const imgW = parentSigImage.width * scale;
              const imgH = parentSigImage.height * scale;
              const drawX = rect.x + (rect.width - imgW) / 2;
              const drawY = rect.y + (rect.height - imgH) / 2;
              // Draw twice — second pass darkens semi-transparent stroke pixels
              firstPage.drawImage(parentSigImage, { x: drawX, y: drawY, width: imgW, height: imgH });
              firstPage.drawImage(parentSigImage, { x: drawX, y: drawY, width: imgW, height: imgH });
            } catch (e) { /* field not found for this row */ }
          }
        }
        form.flatten();

        // Draw county over the flattened dropdown (white cover + text on top)
        if (countyRect && countyValue) {
          const helvetica = await tempDoc.embedFont(StandardFonts.Helvetica);
          firstPage.drawRectangle({
            x: countyRect.x + 1,
            y: countyRect.y + 1,
            width: countyRect.width - 2,
            height: countyRect.height - 2,
            color: rgb(1, 1, 1),
            borderWidth: 0,
          });
          firstPage.drawText(countyValue, {
            x: countyRect.x + 3,
            y: countyRect.y + (countyRect.height - 10) / 2,
            size: 10,
            font: helvetica,
            color: rgb(0, 0, 0),
          });
        }

        const [copiedPage] = await finalNjeisPdf.copyPages(tempDoc, [0]);
        finalNjeisPdf.addPage(copiedPage);
      }
    }

    const njeisPdfBuffer = await finalNjeisPdf.save();

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const practName = `${practitioner.first_name}_${practitioner.last_name}`.replace(/\s+/g, '_');
    const folderPath = `${yearMonth}/${practName}`;

    // Build a unique filename: service date range + generation timestamp so multiple
    // NJEIS runs for the same practitioner never overwrite each other in the vault.
    const serviceDates = filteredAssessments.map(a => a.service_date).filter(Boolean).sort();
    const minDate = (serviceDates[0] || '').replace(/-/g, '');
    const maxDate = (serviceDates[serviceDates.length - 1] || '').replace(/-/g, '');
    const timestamp = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const newFileName = `NJEIS_${minDate}_${maxDate}_${timestamp}.pdf`;
    const filePath = `${folderPath}/${newFileName}`;

    await uploadFile(BILLING_INVOICES_BUCKET, filePath, njeisPdfBuffer, 'application/pdf');

    const signedUrl = await getSignedUrl(BILLING_INVOICES_BUCKET, filePath, 3600);

    // Create a billing_batches record so the vault can scope this batch's logs precisely
    let batchRow = null;
    try {
      const { rows: batchRows } = await pool.query(
        `INSERT INTO billing_batches (practitioner_id, start_date, end_date, njeis_path)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [practitionerId, serviceDates[0] || null, serviceDates[serviceDates.length - 1] || null, filePath]
      );
      batchRow = batchRows[0];
    } catch (batchInsertError) {
      console.warn('billing_batches insert failed (non-fatal):', batchInsertError.message);
    }

    // Stamp all processed assessments with this batch ID
    if (batchRow) {
      await pool.query('UPDATE assessments SET billing_batch_id = $1 WHERE id = ANY($2::int[])', [batchRow.id, allAssessmentIds]);
    }

    const idsToAdvance = filteredAssessments.filter(a => a.billing_status !== 'rejected').map(a => a.id);
    if (idsToAdvance.length > 0) {
      await pool.query("UPDATE assessments SET billing_status = 'njeis_review' WHERE id = ANY($1::int[])", [idsToAdvance]);
    }

    res.json({ success: true, downloadUrl: signedUrl, batchId: batchRow?.id || null, message: 'SEVF Forms generated successfully!' });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

// --- 4. STEP 2: Issue Financial Invoice ---
const generateFinancialInvoice = async (req, res) => {
  const { practitionerId, startDate, endDate } = req.body;

  try {
    const params = [practitionerId, ['pending', 'njeis_review']];
    let sql = `
      SELECT a.*, to_jsonb(p) AS practitioners, to_jsonb(pt) AS patients
      FROM assessments a
      JOIN practitioners p ON p.id = a.practitioner_id
      LEFT JOIN patients pt ON pt.id = a.patient_id
      WHERE a.practitioner_id = $1 AND a.billing_status = ANY($2::text[])
    `;
    if (startDate) { params.push(startDate); sql += ` AND a.service_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND a.service_date <= $${params.length}`; }
    sql += ' ORDER BY a.service_date ASC';

    const { rows: assessments } = await pool.query(sql, params);
    if (!assessments || assessments.length === 0) return res.status(400).json({ success: false, error: "No reviewed assessments found." });

    const practitioner = assessments[0].practitioners;
    const allAssessmentIds = assessments.map(a => a.id);
    let totalHours = 0;
    const rawPayRate = (practitioner.pay_rate && parseFloat(practitioner.pay_rate) > 0) ? parseFloat(practitioner.pay_rate) : 0;

    const formattedLineItems = assessments.map(line => {
      const hours = line.total_time ? (line.total_time / 60) : 0;
      totalHours += hours;
      return {
        ...line,
        date: line.service_date || "",
        total_hours: hours > 0 ? hours.toFixed(2) : "",
        child_name: `${line.patient_first_name || ''} ${line.patient_last_name || ''}`.trim() || "",
        child_id: line.patients?.child_id || "",
        county: line.patient_county || "",
        rate_of_pay: rawPayRate ? rawPayRate.toFixed(2) : "0.00",
        line_total: (rawPayRate && hours > 0) ? (hours * rawPayRate).toFixed(2) : "0.00"
      };
    });

    const invoicePdfBuffer = await generateInvoicePDF(practitioner, formattedLineItems);

    const invNow = new Date();
    const invYearMonth = `${invNow.getFullYear()}-${String(invNow.getMonth() + 1).padStart(2, '0')}`;
    const invPractName = `${practitioner.first_name}_${practitioner.last_name}`.replace(/\s+/g, '_');
    const invServiceDates = assessments.map(a => a.service_date).filter(Boolean).sort();
    const invMinDate = (invServiceDates[0] || '').replace(/-/g, '');
    const invMaxDate = (invServiceDates[invServiceDates.length - 1] || '').replace(/-/g, '');
    const invTimestamp = `${String(invNow.getHours()).padStart(2,'0')}${String(invNow.getMinutes()).padStart(2,'0')}${String(invNow.getSeconds()).padStart(2,'0')}`;
    const filePath = `${invYearMonth}/${invPractName}/Invoice_${invMinDate}_${invMaxDate}_${invTimestamp}.pdf`;

    await uploadFile(BILLING_INVOICES_BUCKET, filePath, invoicePdfBuffer, 'application/pdf');

    const signedUrl = await getSignedUrl(BILLING_INVOICES_BUCKET, filePath, 3600);

    // Update the billing_batches record with the invoice path (batch ID comes from the assessments)
    const batchId = assessments[0]?.billing_batch_id;
    if (batchId) {
      await pool.query('UPDATE billing_batches SET invoice_path = $1 WHERE id = $2', [filePath, batchId]);
    }

    await pool.query("UPDATE assessments SET billing_status = 'invoiced' WHERE id = ANY($1::int[])", [allAssessmentIds]);

    res.json({ success: true, downloadUrl: signedUrl, message: 'Invoice issued successfully!' });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

// --- 5. Fetch actual files from the invoices bucket ---
const getInvoiceHistory = async (req, res) => {
  try {
    // GCS list is already flat/recursive (unlike Supabase Storage's one-level-at-a-time
    // .list()), so no folder-walking helper is needed here anymore.
    const files = await listFilesDetailed(BILLING_INVOICES_BUCKET, '');
    const validFiles = files
      .filter(f => f.name.endsWith('.pdf'))
      .map(f => ({ name: f.name, created_at: f.createdAt }));

    // Sort files by date descending (newest first)
    validFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, invoices: validFiles });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
  }
};

// --- 6. Generate secure links for the download buttons ---
// Only allow well-formed billing document paths: YYYY-MM/Practitioner_Name/<Type>_..._.pdf
const BILLING_FILE_PATTERN = /^\d{4}-\d{2}\/[A-Za-z0-9_.\- ]+\/(NJEIS|Invoice|Override_Invoice)_\d{8}_\d{8}_\d{6}(_PAID)?\.pdf$/;

const getInvoiceDownloadUrl = async (req, res) => {
  const { fileName } = req.query;
  try {
    // Reject anything that isn't an exact, expected billing-document path (blocks path traversal / arbitrary reads)
    if (typeof fileName !== 'string' || fileName.includes('..') || !BILLING_FILE_PATTERN.test(fileName)) {
      return res.status(400).json({ success: false, error: 'Invalid file reference' });
    }
    const signedUrl = await getSignedUrl(BILLING_INVOICES_BUCKET, fileName, 300); // short-lived (5 min) — these are single-click downloads

    res.json({ success: true, signedUrl });
  } catch (error) {
    console.error("Error generating download link:", error);
    res.status(500).json({ success: false, error: 'Failed to generate download link' });
  }
};

// --- 7. Decline or Restore an Individual Assessment ---
const updateLogStatus = async (req, res) => {
  const { assessmentId, status } = req.body;
  if (!assessmentId || !['declined', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'assessmentId and a valid status (declined | pending) are required' });
  }

  try {
    if (status === 'pending') {
      // Also clears any hold_note/held_at — this is the same path used to
      // release a log off Hold back into the regular pending queue.
      await pool.query(
        "UPDATE assessments SET billing_status = $1, billing_review = 'accept', hold_note = NULL, held_at = NULL WHERE id = $2",
        [status, assessmentId]
      );
    } else {
      await pool.query('UPDATE assessments SET billing_status = $1 WHERE id = $2', [status, assessmentId]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating log status:', error);
    res.status(500).json({ error: 'Failed to update log status' });
  }
};

// --- 8. Reject, Return, or Hold a Log ---
// type='return' → billing_status='rejected'  (practitioner must revise and resubmit)
// type='reject' → billing_status='declined'  (billing final rejection, practitioner notified, no update needed)
// type='hold'   → billing_status='on_hold'   (set aside into its own section for this practitioner, reviewed later)
const rejectLog = async (req, res) => {
  const { assessmentId, note, type = 'return' } = req.body;
  if (!assessmentId || !note?.trim()) {
    return res.status(400).json({ error: 'assessmentId and a note are required' });
  }
  if (!['return', 'reject', 'hold'].includes(type)) {
    return res.status(400).json({ error: 'type must be return, reject, or hold' });
  }
  try {
    if (type === 'hold') {
      await pool.query(
        `UPDATE assessments
         SET billing_status = 'on_hold', billing_review = 'hold', hold_note = $1, held_at = $2
         WHERE id = $3`,
        [note.trim(), new Date().toISOString(), assessmentId]
      );
      return res.json({ success: true });
    }

    const { rows: currentRows } = await pool.query(
      'SELECT rejection_count FROM assessments WHERE id = $1',
      [assessmentId]
    );
    const current = currentRows[0];

    const newStatus = type === 'reject' ? 'declined' : 'rejected';

    await pool.query(
      `UPDATE assessments
       SET billing_status = $1, billing_review = $2, rejection_note = $3, rejected_at = $4, rejection_count = $5
       WHERE id = $6`,
      [newStatus, type, note.trim(), new Date().toISOString(), (current?.rejection_count || 0) + 1, assessmentId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error processing log action:', error);
    res.status(500).json({ error: 'Failed to process log action' });
  }
};

// --- 9. Fetch Individual Logs for a Practitioner ---
const getPractitionerLogs = async (req, res) => {
  const { practitionerId, startDate, endDate, groupType = 'pending' } = req.query;
  if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });

  try {
    const statusFilter = groupType === 'hold' ? ['on_hold'] : ['pending', 'njeis_review'];
    const params = [practitionerId, statusFilter];
    let sql = `
      SELECT id, billing_status, billing_review, service_date, status, type, location, start_time, end_time,
             total_time, patient_first_name, patient_last_name, rejection_count, hold_note, held_at
      FROM assessments
      WHERE practitioner_id = $1 AND billing_status = ANY($2::text[])
    `;
    if (startDate) { params.push(startDate); sql += ` AND service_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND service_date <= $${params.length}`; }
    sql += ' ORDER BY patient_first_name ASC, service_date ASC';

    const { rows: logs } = await pool.query(sql, params);

    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching practitioner logs:', error);
    res.status(500).json({ error: 'Failed to fetch practitioner logs' });
  }
};

// --- 10. Fetch logs for a completed vault entry (by practitioner name + date range) ---
const getVaultLogs = async (req, res) => {
  const { practitionerFolder, startDate, endDate, isOverride, batchId } = req.query;
  if (!practitionerFolder || (!batchId && (!startDate || !endDate))) {
    return res.status(400).json({ error: 'practitionerFolder and either batchId or startDate+endDate are required' });
  }
  try {
    const selectCols = `id, billing_status, billing_review, service_date, status, type, location, start_time, end_time, total_time, patient_first_name, patient_last_name`;
    const params = [['invoiced', 'declined', 'rejected']];
    let sql = `SELECT ${selectCols} FROM assessments WHERE billing_status = ANY($1::text[])`;

    if (batchId) {
      // New batch: exact scoping by batch ID alone. Deliberately skips the practitioner
      // name lookup below — billing_batch_id is already unambiguous, and resolving the
      // practitioner from the folder name here would break (single-row lookup throws) whenever
      // two practitioners share the same first+last name.
      params.push(batchId);
      sql += ` AND billing_batch_id = $${params.length}`;
    } else {
      const parts = practitionerFolder.split('_');
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');

      const { rows: practitionerRows } = await pool.query(
        'SELECT id FROM practitioners WHERE first_name ILIKE $1 AND last_name ILIKE $2',
        [firstName, lastName]
      );
      const practitioner = practitionerRows[0];

      if (!practitioner) {
        return res.status(404).json({ error: 'Practitioner not found' });
      }

      params.push(practitioner.id);
      sql += ` AND practitioner_id = $${params.length}`;

      if (isOverride === 'true') {
        // Override row: logs explicitly marked as override-invoiced
        params.push(startDate); sql += ` AND service_date >= $${params.length}`;
        params.push(endDate); sql += ` AND service_date <= $${params.length}`;
        sql += ' AND is_override = true';
      } else {
        // Old-batch fallback: date range scoped to logs with no batch ID
        // Prevents new-batch logs (billing_batch_id IS NOT NULL) from bleeding into old-batch expands
        params.push(startDate); sql += ` AND service_date >= $${params.length}`;
        params.push(endDate); sql += ` AND service_date <= $${params.length}`;
        sql += ' AND billing_batch_id IS NULL AND is_override = false';
      }
    }

    sql += ' ORDER BY patient_first_name ASC, service_date ASC';
    const { rows: logs } = await pool.query(sql, params);

    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching vault logs:', error);
    res.status(500).json({ error: 'Failed to fetch vault logs' });
  }
};

// --- 11. Return all billing_batches records (for vault batchId lookup) ---
const getBillingBatches = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.id, b.njeis_path, b.invoice_path, b.start_date, b.end_date, b.practitioner_id,
             b.printed_at, b.paid_at, b.stamped_invoice_path,
             jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name) AS practitioners
      FROM billing_batches b
      JOIN practitioners p ON p.id = b.practitioner_id
      ORDER BY b.created_at DESC
    `);
    res.json({ success: true, batches: rows || [] });
  } catch (error) {
    console.error('getBillingBatches error:', error);
    res.status(500).json({ error: 'Failed to fetch billing batches' });
  }
};

// --- 13. Mark/unmark a batch's invoice as printed ---
const markBatchPrinted = async (req, res) => {
  const { id } = req.params;
  const { printed } = req.body;
  if (typeof printed !== 'boolean') return res.status(400).json({ success: false, error: 'printed (boolean) is required' });

  try {
    await pool.query(
      'UPDATE billing_batches SET printed_at = $1 WHERE id = $2',
      [printed ? new Date().toISOString() : null, id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('markBatchPrinted error:', error);
    res.status(500).json({ success: false, error: 'Failed to update printed status' });
  }
};

// --- 14. Mark/unmark a batch's invoice as paid — stamps (or un-stamps) the PDF accordingly ---
const markBatchPaid = async (req, res) => {
  const { id } = req.params;
  const { paid } = req.body;
  if (typeof paid !== 'boolean') return res.status(400).json({ success: false, error: 'paid (boolean) is required' });

  try {
    const { rows: batchRows } = await pool.query(
      'SELECT id, invoice_path, paid_at, stamped_invoice_path FROM billing_batches WHERE id = $1',
      [id]
    );
    const batch = batchRows[0];
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    if (paid) {
      if (batch.paid_at) return res.json({ success: true, paid_at: batch.paid_at, stamped_invoice_path: batch.stamped_invoice_path }); // idempotent no-op
      if (!batch.invoice_path) return res.status(400).json({ success: false, error: 'This batch has no invoice PDF to stamp' });

      const pdfBytes = await downloadFile(BILLING_INVOICES_BUCKET, batch.invoice_path);
      const backupPath = batch.invoice_path.replace(/\.pdf$/, '_UNSTAMPED_BACKUP.pdf');

      // Keep the pristine bytes only as an internal restore point for un-marking paid —
      // this filename deliberately doesn't match BILLING_FILE_PATTERN or the Completed
      // Bills parsing regex, so it never surfaces as a second downloadable/visible invoice.
      // invoice_path itself is overwritten below with the stamped bytes, so there is
      // exactly one discoverable invoice file per batch at all times, not two versions.
      await uploadFile(BILLING_INVOICES_BUCKET, backupPath, pdfBytes, 'application/pdf');

      const paidAt = new Date().toISOString();
      const stampedBytes = await stampInvoicePaid(pdfBytes);
      await uploadFile(BILLING_INVOICES_BUCKET, batch.invoice_path, stampedBytes, 'application/pdf');

      await pool.query(
        'UPDATE billing_batches SET paid_at = $1 WHERE id = $2',
        [paidAt, id]
      );

      res.json({ success: true, paid_at: paidAt });
    } else {
      if (batch.stamped_invoice_path) {
        // Legacy paid batches (stamped before this change used a separate "_PAID" sibling
        // file) — invoice_path was never touched for these, so just delete the sibling.
        try {
          await removeFiles(BILLING_INVOICES_BUCKET, [batch.stamped_invoice_path]);
        } catch (removeError) {
          console.error('markBatchPaid: legacy stamped file delete error (continuing):', removeError);
        }
      } else if (batch.invoice_path) {
        // Current behavior: invoice_path was overwritten in place with the stamped bytes —
        // restore the pristine original from its internal backup copy.
        const backupPath = batch.invoice_path.replace(/\.pdf$/, '_UNSTAMPED_BACKUP.pdf');
        try {
          const originalBytes = await downloadFile(BILLING_INVOICES_BUCKET, backupPath);
          await uploadFile(BILLING_INVOICES_BUCKET, batch.invoice_path, originalBytes, 'application/pdf');
          await removeFiles(BILLING_INVOICES_BUCKET, [backupPath]);
        } catch (restoreError) {
          console.error('markBatchPaid: unstamped backup restore error (continuing):', restoreError);
        }
      }
      await pool.query(
        'UPDATE billing_batches SET paid_at = NULL, stamped_invoice_path = NULL WHERE id = $1',
        [id]
      );

      res.json({ success: true });
    }
  } catch (error) {
    console.error('markBatchPaid error:', error);
    res.status(500).json({ success: false, error: 'Failed to update paid status' });
  }
};

// --- 12. Revert a Completed Batch back to Pending ---
// Deletes the batch's SEVF + Invoice PDFs from storage, un-stamps every linked
// assessment back to billing_status='pending', and removes the billing_batches row.
// Order matters for partial-failure safety: assessments are freed first (the part
// with real product consequence), then storage files, then the batch row last —
// each step's failure still leaves enough state for a retry to finish cleanly.
const revertBillingBatch = async (req, res) => {
  const { batchId } = req.body;
  if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' });

  try {
    const { rows: batchRows } = await pool.query(
      'SELECT id, njeis_path, invoice_path, paid_at FROM billing_batches WHERE id = $1',
      [batchId]
    );
    const batch = batchRows[0];

    if (!batch) {
      return res.status(404).json({ success: false, error: 'Batch not found (it may have already been reverted).' });
    }

    if (batch.paid_at) {
      return res.status(400).json({ success: false, error: 'This invoice has been marked as paid and can no longer be sent back to pending.' });
    }

    const { rows: revertedAssessments } = await pool.query(
      "UPDATE assessments SET billing_status = 'pending', billing_batch_id = NULL WHERE billing_batch_id = $1 RETURNING id",
      [batchId]
    );

    const filePaths = [batch.njeis_path, batch.invoice_path].filter(Boolean);
    if (filePaths.length > 0) {
      try {
        await removeFiles(BILLING_INVOICES_BUCKET, filePaths);
      } catch (storageError) {
        console.error('revertBillingBatch: storage delete error (continuing):', storageError);
      }
    }

    await pool.query('DELETE FROM billing_batches WHERE id = $1', [batchId]);

    res.json({
      success: true,
      message: 'Batch reverted — logs are back in Pending Bills.',
      assessmentsReverted: revertedAssessments?.length || 0,
    });
  } catch (error) {
    console.error('revertBillingBatch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// --- 15. Lock a practitioner's Pending Bills row so only one billing specialist works it ---
const lockPractitioner = async (req, res) => {
  const practitionerId = parseInt(req.params.id, 10);
  const lockerId = req.practitioner.practitionerId;
  if (!practitionerId) return res.status(400).json({ success: false, error: 'Invalid practitioner id' });

  try {
    const { rows: insertedRows } = await pool.query(
      `INSERT INTO billing_locks (practitioner_id, locked_by)
       VALUES ($1, $2)
       ON CONFLICT (practitioner_id) DO NOTHING
       RETURNING practitioner_id`,
      [practitionerId, lockerId]
    );

    if (insertedRows.length > 0) {
      const { rows: lockerRows } = await pool.query('SELECT first_name, last_name FROM practitioners WHERE id = $1', [lockerId]);
      const locker = lockerRows[0];
      return res.json({ success: true, locked_by_id: lockerId, locked_by_name: `${locker?.first_name || ''} ${locker?.last_name || ''}`.trim() });
    }

    // Already locked — find out by whom.
    const { rows: existingRows } = await pool.query(
      `SELECT bl.locked_by, p.first_name, p.last_name
       FROM billing_locks bl JOIN practitioners p ON p.id = bl.locked_by
       WHERE bl.practitioner_id = $1`,
      [practitionerId]
    );
    const existing = existingRows[0];
    const lockedByName = `${existing?.first_name || ''} ${existing?.last_name || ''}`.trim();

    if (existing?.locked_by === lockerId) {
      // Idempotent — already yours.
      return res.json({ success: true, locked_by_id: lockerId, locked_by_name: lockedByName });
    }

    return res.status(409).json({ success: false, error: 'Already locked by another billing specialist', locked_by_name: lockedByName });
  } catch (error) {
    console.error('lockPractitioner error:', error);
    res.status(500).json({ success: false, error: 'Failed to lock practitioner' });
  }
};

// --- 16. Release a practitioner's Pending Bills lock — owner, or a ceo (Admin) override ---
const unlockPractitioner = async (req, res) => {
  const practitionerId = parseInt(req.params.id, 10);
  const requesterId = req.practitioner.practitionerId;
  const requesterRole = req.practitioner.role;
  if (!practitionerId) return res.status(400).json({ success: false, error: 'Invalid practitioner id' });

  try {
    const { rows: existingRows } = await pool.query('SELECT locked_by FROM billing_locks WHERE practitioner_id = $1', [practitionerId]);
    const existing = existingRows[0];
    if (!existing) return res.json({ success: true }); // already unlocked

    if (existing.locked_by !== requesterId && requesterRole !== 'ceo') {
      return res.status(403).json({ success: false, error: 'Only the billing specialist holding this lock (or an Admin) can release it' });
    }

    await pool.query('DELETE FROM billing_locks WHERE practitioner_id = $1', [practitionerId]);
    res.json({ success: true });
  } catch (error) {
    console.error('unlockPractitioner error:', error);
    res.status(500).json({ success: false, error: 'Failed to release lock' });
  }
};

module.exports = {
  getPendingLogs,
  generateNJEISForms,
  generateFinancialInvoice,
  getInvoiceHistory,
  getInvoiceDownloadUrl,
  getPractitionerLogs,
  updateLogStatus,
  rejectLog,
  getVaultLogs,
  getBillingBatches,
  revertBillingBatch,
  markBatchPrinted,
  markBatchPaid,
  lockPractitioner,
  unlockPractitioner
};
