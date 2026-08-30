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
const { getCompanyName } = require('../utils/companyName');
const { stampInvoicePaid } = require('../utils/invoiceStamper');
const { getDisciplineCode, mapDisciplineToCode } = require('../utils/disciplineCodes');
const { formatTime12h } = require('../utils/formatting');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const {
  serviceCodeLabel, locationCodeLabel, groupSizeCodeLabel, statusCodeLabel, codeLabel,
  mapServiceLabelToCode, mapLocationLabelToCode, mapGroupSizeLabelToCode, mapStatusLabelToCode, mapCategoryLabelToCode,
  resolveStrictnessProfile,
} = require('../constants/njeis');
const { logAudit } = require('../utils/auditLog');
const { normalizeForMatch, scoredNamesMatch } = require('../utils/textMatch');
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
    // 'rejected' (Returned, awaiting practitioner revision) and 'declined'
    // (permanently rejected) stay visible here only until the practitioner's
    // batch is actually generated — once Generate & Issue has run (a
    // njeis_review record with a billing_batch_id exists for them), those
    // rejected/declined logs were excluded from that batch on purpose and
    // just clutter Pending Bills from then on. From that point they're only
    // reachable through Master Reports, which already supports filtering by
    // Returned/rejected status.
    const params = [['pending', 'njeis_review', 'on_hold', 'rejected', 'declined']];
    let sql = `
      SELECT a.*, p.first_name AS practitioner_live_first_name, p.last_name AS practitioner_live_last_name
      FROM assessments a
      JOIN practitioners p ON p.id = a.practitioner_id
      WHERE a.billing_status = ANY($1::text[])
        AND NOT (
          a.billing_status IN ('rejected', 'declined')
          AND (
            a.reconciled_at IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM assessments a2
              WHERE a2.practitioner_id = a.practitioner_id
                AND a2.billing_status = 'njeis_review'
                AND a2.billing_batch_id IS NOT NULL
            )
          )
        )
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

    // Held logs stay in the same practitioner group as their regular pending/
    // njeis_review logs — Hold is just a per-log "don't include this one in
    // SEVF/invoice generation yet" marker (already enforced by those queries
    // only selecting 'pending'/'njeis_review'), not a separate queue.
    const practitionerMap = {};
    const batchIdsByPractitioner = {};

    assessments.forEach(record => {
      const pId = record.practitioner_id;

      if (!practitionerMap[pId]) {
        practitionerMap[pId] = {
          practitioner_id: pId,
          first_name: record.practitioner_live_first_name || 'Unknown',
          last_name: record.practitioner_live_last_name || 'Unknown',
          total_interventions: 0,
          unique_children: new Set(),
          total_hours: 0,
          on_hold_count: 0,
          workflow_status: 'njeis_review',
          locked_by_id: lockMap[pId]?.locked_by_id || null,
          locked_by_name: lockMap[pId]?.locked_by_name || null,
        };
        batchIdsByPractitioner[pId] = new Set();
      }

      if (record.billing_status === 'pending') {
        practitionerMap[pId].workflow_status = 'pending';
      }
      if (record.billing_status === 'on_hold') {
        practitionerMap[pId].on_hold_count += 1;
      }
      // Only njeis_review logs represent an in-flight generate/complete cycle —
      // their batch(es) are what "Send to Completed Bills" cares about.
      if (record.billing_status === 'njeis_review' && record.billing_batch_id) {
        batchIdsByPractitioner[pId].add(record.billing_batch_id);
      }

      practitionerMap[pId].total_interventions += 1;
      practitionerMap[pId].unique_children.add(record.patient_id);

      const hours = record.total_time ? (record.total_time / 60) : 0;
      practitionerMap[pId].total_hours += hours;
    });

    // Resolve each practitioner's in-flight batches (from billing_batches, not
    // local component state) so "documents generated, ready to send" survives
    // polling/refresh/navigation instead of being lost the moment the
    // generate response leaves memory.
    const allBatchIds = Array.from(new Set(Object.values(batchIdsByPractitioner).flatMap(s => Array.from(s))));
    const batchesById = {};
    if (allBatchIds.length > 0) {
      const { rows: batchRows } = await pool.query(
        'SELECT id, start_date, njeis_path, invoice_path FROM billing_batches WHERE id = ANY($1::uuid[])',
        [allBatchIds]
      );
      batchRows.forEach(b => { batchesById[b.id] = b; });
    }

    const logs = await Promise.all(Object.values(practitionerMap).map(async log => {
      const batchIds = Array.from(batchIdsByPractitioner[log.practitioner_id] || []);
      const batches = batchIds.map(id => batchesById[id]).filter(Boolean);

      const sevf_documents = [];
      const invoice_documents = [];
      await Promise.all(batches.map(async batch => {
        const month = batch.start_date ? String(batch.start_date).slice(0, 7) : 'unknown';
        if (batch.njeis_path) {
          sevf_documents.push({ month, url: await getSignedUrl(BILLING_INVOICES_BUCKET, batch.njeis_path, 3600) });
        }
        if (batch.invoice_path) {
          invoice_documents.push({ month, url: await getSignedUrl(BILLING_INVOICES_BUCKET, batch.invoice_path, 3600) });
        }
      }));

      // Ready only once every in-flight batch has both documents — a batch
      // missing its invoice (partial-failure mid-generation) shouldn't let
      // the practitioner get marked complete.
      const readyToComplete = batches.length > 0 && batches.every(b => b.njeis_path && b.invoice_path);

      return {
        ...log,
        unique_children_count: log.unique_children.size,
        unique_children: undefined,
        sevf_documents,
        invoice_documents,
        readyToComplete,
      };
    }));

    logs.sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

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

    const companyName = await getCompanyName();

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

        setUniformText('Service Provider Agency Name', companyName);
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
          setUniformText(`Start TimeRow${rowNum}`, formatTime12h(session.start_time));
          setUniformText(`End TimeRow${rowNum}`, formatTime12h(session.end_time));
          setUniformText(`Total TimeRow${rowNum}`, session.total_time?.toString());
        });

        // The date next to the practitioner's certification signature is the
        // most recent service_date among this chunk's own rows (the actual
        // sessions listed on this specific form) — not today's date, which
        // is just whenever this PDF happened to be generated/regenerated.
        const chunkDates = chunk.map((s) => s.service_date).filter(Boolean).sort();
        const lastChunkDate = chunkDates[chunkDates.length - 1];
        setUniformText('Date', lastChunkDate
          ? new Date(`${lastChunkDate}T00:00:00`).toLocaleDateString()
          : new Date().toLocaleDateString());
        const pages = tempDoc.getPages();
        const firstPage = pages[0];

        if (pData.practitioner_signature) {
          try {
            // Scaled relative to the "Practitioner Signature" field's own box
            // (same approach as the parent-signature loop below) rather than a
            // fixed fraction of the source image's raw pixel size — the mobile
            // app's signature pad captures at devicePixelRatio resolution
            // (2-3x on most phones), so a fixed scale made mobile-drawn
            // signatures come out several times too large and spill into the
            // surrounding form text.
            const pracSigField = form.getTextField('Practitioner Signature');
            const rect = pracSigField.acroField.getWidgets()[0].getRectangle();
            const practSigImage = await tempDoc.embedPng(pData.practitioner_signature);
            const padding = 2;
            const maxW = rect.width - padding * 2;
            const maxH = rect.height - padding * 2;
            const scale = Math.min(maxW / practSigImage.width, maxH / practSigImage.height) * 1.5;
            const imgW = practSigImage.width * scale;
            const imgH = practSigImage.height * scale;
            const drawX = rect.x + (rect.width - imgW) / 2;
            const drawY = rect.y + (rect.height - imgH) / 2;
            firstPage.drawImage(practSigImage, { x: drawX, y: drawY, width: imgW, height: imgH });
            firstPage.drawImage(practSigImage, { x: drawX, y: drawY, width: imgW, height: imgH });
          } catch (e) { /* field not found */ }
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
              // Signature source images are mostly blank canvas around a small
              // stroke, so a tight fit-to-box scale still reads as tiny — enlarge
              // beyond that and let it bleed slightly into the row's padding
              // (still centered on the same cell), same as real ink overflowing a line.
              const scale = Math.min(maxW / parentSigImage.width, maxH / parentSigImage.height) * 1.5;
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

    logAudit({
      req, action: 'njeis_pdf_generate', resourceType: 'billing_batch', resourceId: batchRow?.id || null,
      details: { practitionerId, assessmentCount: allAssessmentIds.length },
    });
    res.json({ success: true, downloadUrl: signedUrl, batchId: batchRow?.id || null, message: 'SEVF Forms generated successfully!' });
  } catch (error) {
    console.error('Error generating NJEIS forms:', error);
    res.status(500).json({ success: false, error: 'Failed to generate NJEIS forms' });
  }
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

    const { rows: specialistRows } = await pool.query(
      'SELECT first_name, last_name FROM practitioners WHERE id = $1',
      [req.practitioner.practitionerId]
    );
    const processedBy = specialistRows[0]
      ? `${specialistRows[0].first_name || ''} ${specialistRows[0].last_name || ''}`.trim()
      : '';

    const companyName = await getCompanyName();

    const invoicePdfBuffer = await generateInvoicePDF(practitioner, formattedLineItems, processedBy, companyName);

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

    // Deliberately NOT flipping billing_status to 'invoiced' here — the row
    // stays visible (and billable-batch-editable) in Pending Bills until the
    // billing specialist explicitly confirms via "Send to Completed Bills"
    // (see completeBilling below), even though both documents already exist.

    logAudit({
      req, action: 'invoice_pdf_generate', resourceType: 'billing_batch', resourceId: batchId || null,
      details: { practitionerId, assessmentCount: assessments.length },
    });
    res.json({ success: true, downloadUrl: signedUrl, message: 'Invoice issued successfully!' });
  } catch (error) {
    console.error('Error generating financial invoice:', error);
    res.status(500).json({ success: false, error: 'Failed to generate invoice' });
  }
};

// --- 4b. STEP 3: Move a practitioner's fully-generated logs to Completed Bills ---
// Only advances logs already past both generation steps (billing_status
// 'njeis_review' means generateNJEISForms already ran on them; the frontend
// only enables this action once both SEVF and invoice documents exist).
const completeBilling = async (req, res) => {
  const { practitionerId } = req.body;
  if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });

  try {
    const { rows } = await pool.query(
      `UPDATE assessments SET billing_status = 'invoiced'
       WHERE practitioner_id = $1 AND billing_status = 'njeis_review'
       RETURNING id`,
      [practitionerId]
    );
    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No generated logs are ready to complete for this practitioner.' });
    }
    res.json({ success: true, count: rows.length });
  } catch (error) {
    console.error('Error completing billing:', error);
    res.status(500).json({ success: false, error: 'Failed to move logs to Completed Bills' });
  }
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

// --- Practitioner self-service: their own approved (issued) invoices,
// each showing whether it's been paid yet — reuses getBillingBatches'
// exact "completed" check (at least one of the batch's assessments has
// billing_status = 'invoiced') so a still-in-progress batch never shows
// up here as if it were a real invoice.
const getMyInvoices = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.start_date, b.end_date, b.paid_at,
              EXISTS (
                SELECT 1 FROM assessments a WHERE a.billing_batch_id = b.id AND a.billing_status = 'invoiced'
              ) AS approved
       FROM billing_batches b
       WHERE b.practitioner_id = $1 AND b.invoice_path IS NOT NULL
       ORDER BY b.start_date DESC`,
      [practitionerId]
    );

    const invoices = rows
      .filter((b) => b.approved)
      .map((b) => ({
        id: b.id,
        start_date: b.start_date,
        end_date: b.end_date,
        paid: !!b.paid_at,
        paid_at: b.paid_at,
      }));

    res.json({ success: true, invoices });
  } catch (error) {
    console.error('getMyInvoices error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
  }
};

// Ownership-scoped by practitioner_id (unlike the admin getInvoiceDownloadUrl
// above, which trusts an arbitrary bucket path) — a practitioner can only
// ever get a signed URL for one of their own batches.
const getMyInvoiceDownloadUrl = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT invoice_path, stamped_invoice_path, paid_at FROM billing_batches WHERE id = $1 AND practitioner_id = $2`,
      [id, practitionerId]
    );
    const batch = rows[0];
    if (!batch) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const path = batch.paid_at && batch.stamped_invoice_path ? batch.stamped_invoice_path : batch.invoice_path;
    if (!path) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const signedUrl = await getSignedUrl(BILLING_INVOICES_BUCKET, path, 300);
    res.json({ success: true, signedUrl });
  } catch (error) {
    console.error('getMyInvoiceDownloadUrl error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate download link' });
  }
};

// --- 7. Decline or Restore an Individual Assessment ---
const updateLogStatus = async (req, res) => {
  const { assessmentId, status, review } = req.body;
  if (!assessmentId || !['declined', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'assessmentId and a valid status (declined | pending) are required' });
  }

  try {
    // Approve is the one transition that must never go through past an
    // unresolved compliance mismatch — recompute live rather than trusting
    // whatever the client last saw, since a learned rule or another
    // biller's Allow could have changed things since the client's last fetch.
    if (status === 'pending' && review === 'accept') {
      const compliance = await computeSessionCompliance(assessmentId);
      if (compliance.flagged) {
        // TEMP DIAGNOSTIC — remove once the Session-Detail vs Compliance-
        // Analysis flag disagreement is confirmed resolved.
        console.log('[approve-blocked] assessment', assessmentId, {
          matched: compliance.matched,
          mismatchedFields: (compliance.fields || []).filter((f) => f.match === false)
            .map((f) => ({ key: f.key, ours: f.ours, state: f.state })),
        });
        return res.status(400).json({ error: 'This log still has unresolved compliance mismatches — allow each flagged field before approving.' });
      }
      // "Missing in EIMS" (no matching state record at all) is a distinct,
      // higher-stakes gap than a field-level mismatch — there's nothing to
      // "Allow" against, so it needs the full send-to-admin workflow
      // (sendMissingToAdmin -> ceo's Action Required queue -> decideMissingInEims)
      // before ANY role, including ceo, can approve the log itself.
      if (compliance.documentOnFile && !compliance.matched && compliance.eimsMissingStatus !== 'approved') {
        return res.status(400).json({ error: 'This log has no matching record in the state document — send it to an admin for approval under Compliance Analysis before it can be approved.' });
      }
    }

    if (status === 'pending') {
      // `review` distinguishes the three callers that land here:
      // Approve passes 'accept'; Release-from-Hold and the "reset to
      // pending" undo both pass null so the log goes back to a genuinely
      // unreviewed state (previously this always forced 'accept', so a
      // released-from-hold log silently came back marked Approved).
      // Also clears any hold_note/held_at — this is the same path used to
      // release a log off Hold back into the regular pending queue.
      await pool.query(
        "UPDATE assessments SET billing_status = $1, billing_review = $2, hold_note = NULL, held_at = NULL WHERE id = $3",
        [status, review || null, assessmentId]
      );
      // Going back to a genuinely unreviewed state means any one-time
      // Allow clicked on THIS log no longer applies — otherwise a real
      // mismatch that was accidentally allowed once would stay silently
      // cleared forever, even after being sent back for fresh re-review.
      // Only the per-log acknowledgment is cleared here — a reusable
      // learned rule (compliance_match_overrides) is a standing,
      // cross-log decision and is untouched by resetting one log.
      if (!review) {
        await pool.query('DELETE FROM compliance_field_acknowledgments WHERE assessment_id = $1', [assessmentId]);
      }
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
  if (!['return', 'reject', 'hold'].includes(type)) {
    return res.status(400).json({ error: 'type must be return, reject, or hold' });
  }
  // Hold is a one-click "set this log aside for now" action — no note
  // required. Return/Reject still need one so the practitioner knows what
  // to fix (or why it was rejected).
  if (!assessmentId || (type !== 'hold' && !note?.trim())) {
    return res.status(400).json({ error: 'assessmentId and a note are required' });
  }
  try {
    if (type === 'hold') {
      await pool.query(
        `UPDATE assessments
         SET billing_status = 'on_hold', billing_review = 'hold', hold_note = $1, held_at = $2
         WHERE id = $3`,
        [note?.trim() || null, new Date().toISOString(), assessmentId]
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

    // Both 'return' (revision cycle) and 'reject' (permanent decline) get a
    // note from billing — record it in the same shared history so it shows
    // up in the comment/notes box either way, not just for returns.
    if (type === 'return' || type === 'reject') {
      await pool.query(
        `INSERT INTO assessment_notes (assessment_id, author_id, author_role, note)
         VALUES ($1, $2, $3, $4)`,
        [assessmentId, req.practitioner.practitionerId, req.practitioner.role, note.trim()]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error processing log action:', error);
    res.status(500).json({ error: 'Failed to process log action' });
  }
};

// --- 8b. Reconcile a rejected/declined log out of Pending Bills ---
// For a log whose practitioner never had a batch generated (e.g. every
// remaining log in the group ended up rejected, so Generate & Issue can
// never run), the existing "hide once a batch exists" rule never kicks in
// and it sits in Pending Bills forever. This gives billing an explicit,
// one-way action to sweep it out — from then on it's only visible via
// Master Reports, same as a batch-covered rejected/declined log already is.
const reconcileLog = async (req, res) => {
  const { assessmentId } = req.body;
  if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

  try {
    const { rows } = await pool.query(
      `UPDATE assessments
       SET reconciled_at = $1
       WHERE id = $2 AND billing_status IN ('rejected', 'declined')
       RETURNING id`,
      [new Date().toISOString(), assessmentId]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Log is not in a rejected or declined state' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error reconciling log:', error);
    res.status(500).json({ error: 'Failed to reconcile log' });
  }
};

// --- 8c. Add a plain comment to a log's thread, independent of any status
// change. Return/reject already record a note via rejectLog above — this
// covers the general case (the Batch Review beta's inline comment thread),
// where billing wants to leave a note without touching billing_status. ---
const addLogComment = async (req, res) => {
  const { assessmentId, note } = req.body;
  if (!assessmentId || !note?.trim()) {
    return res.status(400).json({ error: 'assessmentId and note are required' });
  }
  try {
    await pool.query(
      `INSERT INTO assessment_notes (assessment_id, author_id, author_role, note)
       VALUES ($1, $2, $3, $4)`,
      [assessmentId, req.practitioner.practitionerId, req.practitioner.role, note.trim()]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding log comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
};

// --- 9. Fetch Individual Logs for a Practitioner ---
const getPractitionerLogs = async (req, res) => {
  const { practitionerId, startDate, endDate } = req.query;
  if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });

  try {
    // Held logs are returned alongside the practitioner's regular pending/
    // njeis_review logs (not a separate fetch) — Hold is a per-log marker,
    // not its own queue. 'rejected' (Returned, awaiting revision) and
    // 'declined' (permanently rejected) also stay visible, but only until
    // this practitioner's batch has actually been generated (see
    // getPendingLogs for the full rationale) — after that they're excluded
    // here too and only reachable via Master Reports.
    const params = [practitionerId, ['pending', 'njeis_review', 'on_hold', 'rejected', 'declined']];
    let sql = `
      SELECT assessments.id, billing_status, billing_review, service_date, status, type, location, start_time, end_time,
             total_time, patient_first_name, patient_last_name, rejection_count, hold_note, held_at,
             group_size_category, form_data,
             COALESCE(an.notes_count, 0) AS notes_count
      FROM assessments
      LEFT JOIN (
        SELECT assessment_id, COUNT(*) AS notes_count FROM assessment_notes GROUP BY assessment_id
      ) an ON an.assessment_id = assessments.id
      WHERE practitioner_id = $1 AND billing_status = ANY($2::text[])
        AND NOT (
          billing_status IN ('rejected', 'declined')
          AND (
            reconciled_at IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM assessments a2
              WHERE a2.practitioner_id = assessments.practitioner_id
                AND a2.billing_status = 'njeis_review'
                AND a2.billing_batch_id IS NOT NULL
            )
          )
        )
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

// --- 9b. Fetch the full return/resubmit note history for one log ---
const getLogNotes = async (req, res) => {
  const { assessmentId } = req.query;
  if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

  try {
    const { rows: notes } = await pool.query(
      `SELECT n.author_role, n.note, n.created_at, p.first_name, p.last_name
       FROM assessment_notes n
       LEFT JOIN practitioners p ON p.id = n.author_id
       WHERE n.assessment_id = $1
       ORDER BY n.created_at ASC`,
      [assessmentId]
    );
    res.json({ success: true, notes });
  } catch (error) {
    console.error('Error fetching log notes:', error);
    res.status(500).json({ error: 'Failed to fetch log notes' });
  }
};

// Parses a Total Time custom field's raw stored value (either "H:MM" text —
// see companyController.js's cellToDurationText — or a plain number) into
// total minutes, so it can be compared against our own session.total_time
// (already an int). Returns null if unparseable.
function parseDurationMinutes(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const hm = s.match(/^(\d+):(\d{2})$/);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
  const num = parseFloat(s);
  return Number.isNaN(num) ? null : Math.round(num);
}

// Mirrors the frontend's formatTime() (e.g. BillingManager.jsx) so the
// "ours" side of a Total Time comparison reads the same way as everywhere
// else in the app instead of a bare minute count.
function formatMinutesLabel(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Fields removed on the Company Information mapping screen have no column
// mapped for them anymore — their comparison row is skipped entirely rather
// than showing an always-empty "-" vs "-" row. Shared by every compliance
// computation path.
const FIELD_TO_MAPPING_KEY = {
  child_id: 'child_id', child_name: 'child_name', practitioner_name: 'practitioner_name',
  service_date: 'service_date', start_time: 'start_time', end_time: 'end_time',
  service_type: 'service_label', location: 'location_label', group_size: 'group_size_label',
  logged_date: 'logged_date', ifsp_event_id: 'ifsp_event_id',
};

// Pairwise cost between one of our sessions and one state-log candidate for
// the same patient+date, lower = better match. A null-vs-real time
// mismatch (e.g. our cancelled visit logged no time, but this candidate has
// a real time — or vice versa) is scored as a heavy, explicit penalty
// rather than being invisible to scoring — this is the exact bug this
// replaces: silently treating "can't compare" as "neutral" let a session
// with no comparable time blindly latch onto whichever candidate happened
// to come first, even when a same-day sibling session had a real,
// obviously-correct time match against that exact candidate. Verified
// against a real production case: two same-day sessions for one patient (a
// cancelled visit with no time, and a real 60-minute visit) had two state
// records (one blank, one with matching real times) — the null-time
// session's old "neutral" scoring let it grab the real-timed candidate
// first, leaving the real-timed session incorrectly paired with the blank
// one. NULL_TIME_MISMATCH_PENALTY (1440 minutes = a full day, far larger
// than any two real times in the same day can differ) guarantees a
// same-nullness pairing always wins over a cross pairing, so the correct
// result no longer depends on which session happens to be evaluated first.
const NULL_TIME_MISMATCH_PENALTY = 1440;
function toMinutesOfDay(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function scoreCandidatePair(session, candidate) {
  const ourStart = toMinutesOfDay(session.start_time);
  const ourEnd = toMinutesOfDay(session.end_time);
  const cStart = toMinutesOfDay(candidate.start_time);
  const cEnd = toMinutesOfDay(candidate.end_time);
  let score = 0;
  score += (ourStart != null && cStart != null) ? Math.abs(cStart - ourStart)
    : (ourStart == null && cStart == null) ? 0
    : NULL_TIME_MISMATCH_PENALTY;
  score += (ourEnd != null && cEnd != null) ? Math.abs(cEnd - ourEnd)
    : (ourEnd == null && cEnd == null) ? 0
    : NULL_TIME_MISMATCH_PENALTY;
  return score;
}

// Single-session lookup (used by computeSessionCompliance, where there's no
// sibling-session bookkeeping to worry about) — picks whichever candidate
// scores best against this one session.
function pickBestCandidate(session, candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  let bestScore = Infinity;
  let match = null;
  for (const c of candidates) {
    const score = scoreCandidatePair(session, c);
    if (score < bestScore) { bestScore = score; match = c; }
  }
  return match;
}

// Optimal one-to-one assignment of a patient+date group's sessions to that
// same group's state-log candidates — replaces a greedy "whichever session
// is processed first claims its best candidate" approach (used by the
// batch getComplianceAnalysis loop below), which is exactly what let
// processing order determine the (wrong) outcome in the bug this fixes.
// Brute-forces every permutation of candidates onto sessions and keeps the
// lowest-total-cost assignment — correct regardless of iteration order.
// Real same-day duplicate counts for one patient are always tiny (2-3,
// essentially never more), so this is cheap; MAX_OPTIMAL_GROUP_SIZE guards
// against a pathological import forcing a factorial blowup by falling back
// to a simple greedy pass (still using the corrected per-pair scoring,
// just not globally optimal) instead of hanging the request.
const MAX_OPTIMAL_GROUP_SIZE = 6;
function assignGroupCandidates(groupSessions, groupCandidates) {
  const assignment = new Map(); // session.id -> candidate | null
  if (groupCandidates.length === 0) {
    groupSessions.forEach((s) => assignment.set(s.id, null));
    return assignment;
  }
  if (groupSessions.length === 1 && groupCandidates.length === 1) {
    assignment.set(groupSessions[0].id, groupCandidates[0]);
    return assignment;
  }
  if (Math.max(groupSessions.length, groupCandidates.length) > MAX_OPTIMAL_GROUP_SIZE) {
    const used = new Set();
    for (const s of groupSessions) {
      let best = null;
      let bestScore = Infinity;
      for (const c of groupCandidates) {
        if (used.has(c.id)) continue;
        const score = scoreCandidatePair(s, c);
        if (score < bestScore) { bestScore = score; best = c; }
      }
      if (best) used.add(best.id);
      assignment.set(s.id, best);
    }
    return assignment;
  }

  const size = Math.max(groupSessions.length, groupCandidates.length);
  const paddedSessions = [...groupSessions, ...Array(size - groupSessions.length).fill(null)];
  const paddedCandidates = [...groupCandidates, ...Array(size - groupCandidates.length).fill(null)];

  let bestTotal = Infinity;
  let bestMapping = null;
  const swap = (arr, i, j) => { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; };
  const permute = (arr, k) => {
    if (k === arr.length) {
      let total = 0;
      for (let i = 0; i < size; i++) {
        if (paddedSessions[i] && arr[i]) total += scoreCandidatePair(paddedSessions[i], arr[i]);
      }
      if (total < bestTotal) { bestTotal = total; bestMapping = arr.slice(); }
      return;
    }
    for (let i = k; i < arr.length; i++) {
      swap(arr, k, i);
      permute(arr, k + 1);
      swap(arr, k, i);
    }
  };
  permute(paddedCandidates, 0);

  for (let i = 0; i < size; i++) {
    if (paddedSessions[i]) assignment.set(paddedSessions[i].id, bestMapping[i] || null);
  }
  return assignment;
}

// Compares two HH:MM strings within a tolerance (minutes) driven by the
// active strictness profile — a state clerical typo of a minute or two
// shouldn't flag the same way a genuinely different time would.
function timeWithinTolerance(oursHHMM, stateHHMM, toleranceMinutes) {
  // Both blank means neither side logged a time at all — the expected shape
  // for a cancelled visit (0 time), not a mismatch to flag.
  if (!oursHHMM && !stateHHMM) return { match: true, withinTolerance: false };
  if (!oursHHMM || !stateHHMM) return { match: false, withinTolerance: false };
  const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const diff = Math.abs(toMinutes(oursHHMM) - toMinutes(stateHHMM));
  if (diff === 0) return { match: true, withinTolerance: false };
  return { match: diff <= toleranceMinutes, withinTolerance: diff <= toleranceMinutes };
}

// The learned-rules table (compliance_match_overrides), grouped by field for
// fast lookup — one persisted, admin/billing-confirmed (field, state's raw
// text, our value) pairing per row. Consulted for every session so a single
// past "Allow" fixes every future occurrence of the same labeling difference.
async function loadOverridesByField() {
  const { rows } = await pool.query('SELECT field_key, state_value_normalized, our_value FROM compliance_match_overrides');
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.field_key)) map.set(row.field_key, []);
    map.get(row.field_key).push(row);
  }
  return map;
}

// One-off "allow just this log" records (compliance_field_acknowledgments),
// keyed by `${assessment_id}:${field_key}` — applies to any field, including
// ones that don't generalize into a learned rule.
async function loadAcknowledgments(assessmentIds) {
  if (!assessmentIds.length) return new Map();
  const { rows } = await pool.query(
    'SELECT assessment_id, field_key FROM compliance_field_acknowledgments WHERE assessment_id = ANY($1::int[])',
    [assessmentIds]
  );
  const map = new Map();
  for (const row of rows) map.set(`${row.assessment_id}:${row.field_key}`, row);
  return map;
}

// Builds the field-by-field comparison for one session against its matched
// state record, applying (in order): the strictness-driven baseline
// matching, then the learned-overrides layer, then the per-log
// acknowledgment layer. `_learn` (only present on the 5 learnable fields)
// carries the normalized values a future "Allow" would persist into
// compliance_match_overrides — used internally by allowComplianceField, not
// meant to be hidden from the API response (it's not sensitive, just the
// same ours/state values in a matching-ready shape).
function buildFieldsForSession(session, match, ctx) {
  const { customFieldsByLabel, mappedKeys, matchParams, overridesByField, ackByKey } = ctx;
  // No state record to compare against at all ("Missing in EIMS") — still
  // show our own logged values as rows instead of an empty table, just with
  // every State Record cell blank and nothing flagged (there's nothing on
  // the other side to disagree with).
  if (!match) {
    const ourPractitionerName = [session.practitioner_first_name, session.practitioner_last_name].filter(Boolean).join(' ');
    const ourChildName = `${session.patient_first_name || ''} ${session.patient_last_name || ''}`.trim();
    return [
      { key: 'child_id', label: 'Child ID', ours: session.child_id, state: null, match: null },
      { key: 'child_name', label: 'Child Name', ours: ourChildName || null, state: null, match: null },
      { key: 'practitioner_name', label: 'Practitioner', ours: ourPractitionerName || null, state: null, match: null },
      { key: 'service_date', label: 'Service Date', ours: session.service_date, state: null, match: null },
      { key: 'start_time', label: 'Start Time', ours: session.start_time, state: null, match: null },
      { key: 'end_time', label: 'End Time', ours: session.end_time, state: null, match: null },
      { key: 'service_type', label: 'Service Type', ours: session.type ? serviceCodeLabel(session.type) : null, state: null, match: null },
      { key: 'location', label: 'Location', ours: session.location ? locationCodeLabel(session.location) : null, state: null, match: null },
      { key: 'group_size', label: 'Group Size Category', ours: session.group_size_category ? groupSizeCodeLabel(session.group_size_category) : null, state: null, match: null },
    ].filter((f) => mappedKeys.has(FIELD_TO_MAPPING_KEY[f.key]));
  }

  const ourPractitionerName = [session.practitioner_first_name, session.practitioner_last_name].filter(Boolean).join(' ');
  const statePractitionerName = match.practitioner_name || '';
  const ourChildName = `${session.patient_first_name || ''} ${session.patient_last_name || ''}`.trim();

  // completed_at is a timestamptz (real JS Date from pg), logged_date is a
  // plain date column (already a 'YYYY-MM-DD' string per the DATE type
  // parser override in config/db.js).
  const ourLoggedDate = session.completed_at ? new Date(session.completed_at).toISOString().slice(0, 10) : null;
  const stateLoggedDate = match.logged_date || null;

  const startTimeResult = timeWithinTolerance(session.start_time, match.start_time, matchParams.timeToleranceMinutes);
  const endTimeResult = timeWithinTolerance(session.end_time, match.end_time, matchParams.timeToleranceMinutes);

  const rawFields = [
    {
      key: 'child_id', label: 'Child ID',
      ours: session.child_id, state: match.child_id,
      match: !!session.child_id && !!match.child_id && session.child_id === match.child_id,
    },
    {
      key: 'child_name', label: 'Child Name',
      ours: ourChildName || null, state: match.child_name,
      // Order-independent, threshold-scored word comparison — handles
      // "Last, First" vs "First Last" formatting AND a partial word
      // difference (e.g. a missing middle name) per the active profile.
      match: scoredNamesMatch(ourChildName, match.child_name, matchParams.wordOverlapThreshold),
      _learn: { ourValue: normalizeForMatch(ourChildName), stateValueRaw: match.child_name },
    },
    {
      key: 'practitioner_name', label: 'Practitioner',
      ours: ourPractitionerName || null, state: statePractitionerName || null,
      match: scoredNamesMatch(ourPractitionerName, statePractitionerName, matchParams.wordOverlapThreshold),
      _learn: { ourValue: normalizeForMatch(ourPractitionerName), stateValueRaw: statePractitionerName },
    },
    {
      key: 'service_date', label: 'Service Date',
      ours: session.service_date, state: match.service_date,
      match: true, // this is the join key — always equal by construction
    },
    {
      key: 'start_time', label: 'Start Time',
      ours: session.start_time, state: match.start_time,
      match: startTimeResult.match, withinTolerance: startTimeResult.withinTolerance,
    },
    {
      key: 'end_time', label: 'End Time',
      ours: session.end_time, state: match.end_time,
      match: endTimeResult.match, withinTolerance: endTimeResult.withinTolerance,
    },
    // Service Type/Location/Group Size codes are recomputed from the raw
    // label here rather than trusting the mapped_*_code columns cached on
    // upload — those were computed once at import time, so a state log
    // uploaded before a mapping-logic improvement would otherwise keep
    // showing a stale mismatch forever instead of picking up the fix
    // retroactively.
    {
      key: 'service_type', label: 'Service Type',
      ours: session.type ? serviceCodeLabel(session.type) : null,
      state: match.service_label,
      match: !!session.type && session.type === mapServiceLabelToCode(match.service_label, matchParams.wordOverlapThreshold),
      _learn: { ourValue: session.type, stateValueRaw: match.service_label },
    },
    {
      key: 'location', label: 'Location',
      ours: session.location ? locationCodeLabel(session.location) : null,
      state: match.location_label,
      match: !!session.location && session.location === mapLocationLabelToCode(match.location_label, matchParams.wordOverlapThreshold),
      _learn: { ourValue: session.location, stateValueRaw: match.location_label },
    },
    {
      key: 'group_size', label: 'Group Size Category',
      ours: session.group_size_category ? groupSizeCodeLabel(session.group_size_category) : null,
      state: match.group_size_label,
      match: !!session.group_size_category && session.group_size_category === mapGroupSizeLabelToCode(match.group_size_label, matchParams.wordOverlapThreshold),
      _learn: { ourValue: session.group_size_category, stateValueRaw: match.group_size_label },
    },
    {
      key: 'logged_date', label: 'Logged Date',
      ours: ourLoggedDate, state: stateLoggedDate,
      match: !!ourLoggedDate && !!stateLoggedDate && ourLoggedDate === stateLoggedDate,
    },
    {
      key: 'ifsp_event_id', label: 'IFSP Event ID',
      ours: null, state: match.ifsp_event_id,
      match: null, // we don't track this field at all — informational only
    },
    // User-added custom fields (Company Information's "Add custom field")
    // are state-side only by default — no equivalent on our side, so always
    // informational (no `_learn`, acknowledgment-only). A custom field can
    // optionally be tied to one of our real comparable fields (compareTo),
    // which turns it into a genuine match/mismatch verdict — and, because
    // that means its state text is drawn from a bounded, predictable
    // vocabulary just like the base fields, it also gets `_learn` metadata
    // so an "Allow" persists a reusable rule the same way (e.g. the state's
    // "Makeup Direct Child Service" vs our "Make Up Direct Child Service" —
    // the same wording variant every time this status code appears).
    ...Object.entries(match.extra_fields || {}).map(([label, value]) => {
      const compareTo = customFieldsByLabel.get(label)?.compareTo;
      if (compareTo === 'service_type') {
        const stateCode = mapServiceLabelToCode(value, matchParams.wordOverlapThreshold);
        return {
          key: `custom:${label}`, label,
          ours: session.type ? serviceCodeLabel(session.type) : null,
          state: stateCode ? serviceCodeLabel(stateCode) : value,
          match: !!session.type && !!stateCode && session.type === stateCode,
          _learn: { ourValue: session.type, stateValueRaw: value },
        };
      }
      if (compareTo === 'location') {
        const stateCode = mapLocationLabelToCode(value, matchParams.wordOverlapThreshold);
        return {
          key: `custom:${label}`, label,
          ours: session.location ? locationCodeLabel(session.location) : null,
          state: stateCode ? locationCodeLabel(stateCode) : value,
          match: !!session.location && !!stateCode && session.location === stateCode,
          _learn: { ourValue: session.location, stateValueRaw: value },
        };
      }
      if (compareTo === 'group_size') {
        const stateCode = mapGroupSizeLabelToCode(value, matchParams.wordOverlapThreshold);
        return {
          key: `custom:${label}`, label,
          ours: session.group_size_category ? groupSizeCodeLabel(session.group_size_category) : null,
          state: stateCode ? groupSizeCodeLabel(stateCode) : value,
          match: !!session.group_size_category && !!stateCode && session.group_size_category === stateCode,
          _learn: { ourValue: session.group_size_category, stateValueRaw: value },
        };
      }
      if (compareTo === 'service_status') {
        const stateCode = mapStatusLabelToCode(value, matchParams.wordOverlapThreshold);
        return {
          key: `custom:${label}`, label,
          ours: session.status ? statusCodeLabel(session.status) : null,
          state: stateCode ? statusCodeLabel(stateCode) : value,
          match: !!session.status && !!stateCode && session.status === stateCode,
          _learn: { ourValue: session.status, stateValueRaw: value },
        };
      }
      if (compareTo === 'practitioner_discipline') {
        const ourCode = mapDisciplineToCode(session.practitioner_discipline);
        const stateCode = mapDisciplineToCode(value);
        return {
          key: `custom:${label}`, label,
          ours: session.practitioner_discipline || null,
          state: value,
          match: !!ourCode && !!stateCode && ourCode === stateCode,
          _learn: { ourValue: session.practitioner_discipline, stateValueRaw: value },
        };
      }
      if (compareTo === 'patient_county') {
        return {
          key: `custom:${label}`, label,
          ours: session.patient_county || null,
          state: value,
          match: !!session.patient_county && !!value && normalizeForMatch(session.patient_county) === normalizeForMatch(value),
        };
      }
      if (compareTo === 'patient_dob') {
        // Both sides are already 'YYYY-MM-DD' — session.patient_dob per the
        // DB's date-type-parser override, value per companyController's
        // excelDateToISO extraction for this compareTo (see there).
        return {
          key: `custom:${label}`, label,
          ours: session.patient_dob || null,
          state: value,
          match: !!session.patient_dob && !!value && session.patient_dob === value,
        };
      }
      if (compareTo === 'total_time') {
        // `|| null` on a plain 0 would wipe out a legitimate zero-duration
        // (cancelled) session, so check for null/undefined explicitly.
        const ourMinutes = session.total_time == null ? null : session.total_time;
        const stateMinutes = parseDurationMinutes(value);
        // Both sides logging no/zero duration is the expected shape for a
        // cancelled visit, not a mismatch to flag.
        const bothZeroOrBlank = (ourMinutes == null || ourMinutes === 0) && (stateMinutes == null || stateMinutes === 0);
        const exact = ourMinutes != null && stateMinutes != null && ourMinutes === stateMinutes;
        const withinTolerance = !exact && ourMinutes != null && stateMinutes != null
          && Math.abs(ourMinutes - stateMinutes) <= matchParams.timeToleranceMinutes;
        return {
          key: `custom:${label}`, label,
          ours: ourMinutes != null ? (formatMinutesLabel(ourMinutes) || '0m') : null,
          state: value,
          match: bothZeroOrBlank || exact || withinTolerance, withinTolerance,
        };
      }
      if (compareTo && compareTo.startsWith('custom_category:')) {
        const categoryKey = compareTo.slice('custom_category:'.length);
        const ourCode = session.form_data?.custom_fields?.[categoryKey] || null;
        const stateCode = mapCategoryLabelToCode(categoryKey, value, matchParams.wordOverlapThreshold);
        return {
          key: `custom:${label}`, label,
          ours: ourCode ? codeLabel(categoryKey, ourCode) : null,
          state: stateCode ? codeLabel(categoryKey, stateCode) : value,
          match: !!ourCode && !!stateCode && ourCode === stateCode,
          _learn: { ourValue: ourCode, stateValueRaw: value },
        };
      }
      return { key: `custom:${label}`, label, ours: null, state: value, match: null };
    }),
  ].filter((f) => f.key.startsWith('custom:') || mappedKeys.has(FIELD_TO_MAPPING_KEY[f.key]));

  // A zero-duration log (cancelled visit) is never billed regardless of
  // what else does or doesn't match against the state — nothing to
  // reconcile a payment against — so every field short-circuits to
  // matched instead of requiring an Allow click for e.g. Location.
  if (!session.total_time) {
    return rawFields.map((f) => (f.match === false ? { ...f, match: true, zeroTimeExempt: true } : f));
  }

  return rawFields.map((f) => {
    if (f.match !== false) return f;
    // Learned-override layer: a previously-confirmed pairing for this exact
    // (field, state text, our value) auto-matches from here on, regardless
    // of strictness level.
    if (f._learn) {
      const stateNorm = normalizeForMatch(f._learn.stateValueRaw || '');
      const hit = (overridesByField.get(f.key) || []).find(
        (o) => o.state_value_normalized === stateNorm && o.our_value === f._learn.ourValue
      );
      if (hit) return { ...f, match: true, learnedMatch: true };
    }
    // Per-log acknowledgment layer: applies to any field, including ones
    // that don't generalize into a learned rule.
    if (ackByKey.get(`${session.id}:${f.key}`)) {
      return { ...f, match: true, acknowledged: true };
    }
    return f;
  });
}

// --- 9c. Compliance Analysis — compare a practitioner's logged sessions in
// a period against the state reference document (compliance_state_logs,
// populated from Company Information's uploaded Excel). Match key: same
// patient (via compliance_state_logs.patient_id, resolved from the state's
// Child ID at upload time) + same service_date, then closest start_time
// when a patient has more than one session that day — see
// companyController.applyComplianceDocMapping for how state rows get here.
const getComplianceAnalysis = async (req, res) => {
  const { practitionerId, startDate, endDate } = req.query;
  if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });

  try {
    const { rows: docRows } = await pool.query(
      'SELECT compliance_doc_filename, compliance_doc_uploaded_at, compliance_doc_column_mapping, compliance_doc_path, compliance_doc_applied_path, compliance_doc_custom_fields, compliance_strictness FROM company_settings WHERE id = 1'
    );
    const doc = docRows[0];
    const matchParams = resolveStrictnessProfile(doc?.compliance_strictness);
    // Custom fields are informational-only by default (no equivalent on our
    // side), but a custom field can optionally be tied to one of our real
    // comparable fields (compareTo) to get a real match/mismatch verdict
    // instead — see buildFieldsForSession's custom-fields loop.
    const customFieldsByLabel = new Map(
      (doc?.compliance_doc_custom_fields || []).map((cf) => [cf.label, cf])
    );
    // compliance_doc_applied_path only matches compliance_doc_path once THIS
    // exact uploaded file has actually had its mapping confirmed — a
    // replacement file keeps the old mapping around (so a same-layout
    // replacement doesn't need re-confirming) but compliance_state_logs
    // still reflects whatever was last applied until that happens.
    const documentOnFile = !!(
      doc?.compliance_doc_filename
      && doc?.compliance_doc_column_mapping
      && doc?.compliance_doc_applied_path
      && doc.compliance_doc_applied_path === doc.compliance_doc_path
    );
    const mappedKeys = new Set(
      Object.entries(doc?.compliance_doc_column_mapping || {}).filter(([, header]) => header).map(([key]) => key)
    );

    const params = [practitionerId];
    let sql = `
      SELECT assessments.id, patient_id, service_date, start_time, end_time, total_time, type, location,
             group_size_category, patient_first_name, patient_last_name,
             practitioner_first_name, practitioner_last_name, completed_at, patients.child_id,
             assessments.status, assessments.billing_status, practitioner_discipline, patient_dob, patient_county,
             eims_missing_status, form_data
      FROM assessments
      LEFT JOIN patients ON patients.id = assessments.patient_id
      WHERE assessments.practitioner_id = $1 AND billing_status != 'declined'
    `;
    if (startDate) { params.push(startDate); sql += ` AND service_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND service_date <= $${params.length}`; }
    sql += ' ORDER BY patient_first_name ASC, service_date ASC';
    const { rows: sessions } = await pool.query(sql, params);

    if (!documentOnFile || sessions.length === 0) {
      return res.json({ success: true, documentOnFile, documentFilename: doc?.compliance_doc_filename || null, strictness: doc?.compliance_strictness || 'moderate', results: {} });
    }

    // Lazy sweep: state reference data older than 90 days ages out on its
    // own even if no new file has been uploaded since. Scoped strictly to
    // compliance_state_logs — never touches assessments/patients/billing data.
    await pool.query("DELETE FROM compliance_state_logs WHERE service_date < CURRENT_DATE - INTERVAL '90 days'");

    // Lazy backfill: Child ID -> patient_id is normally resolved once, at
    // upload-confirm time (companyController.applyComplianceDocMapping). A
    // patient added AFTER that point has no link yet — their state rows sit
    // with patient_id NULL until the doc is re-confirmed. Re-resolving any
    // still-unlinked rows on every analysis run means a newly-added patient
    // starts matching immediately, without requiring a manual re-confirm.
    //
    // A Child ID can match more than one patient row (duplicate patient from
    // a name-spelling typo, or a child legitimately re-entered) — a plain
    // single-row UPDATE can only point an unlinked state row at ONE of them,
    // so any other duplicate patient's sessions would always read "Missing
    // in EIMS" even with a real match on file. Give every matching patient
    // its own linked copy: the first match reuses the existing row via
    // UPDATE, and any further matches get their own duplicated row.
    const { rows: unlinkedMatches } = await pool.query(`
      SELECT compliance_state_logs.id AS state_log_id, patients.id AS patient_id
      FROM compliance_state_logs
      JOIN patients
        ON UPPER(REGEXP_REPLACE(compliance_state_logs.child_id, '[^A-Za-z0-9]', '', 'g'))
          = UPPER(REGEXP_REPLACE(patients.child_id, '[^A-Za-z0-9]', '', 'g'))
      WHERE compliance_state_logs.patient_id IS NULL
    `);
    const patientIdsByStateLogId = new Map();
    for (const { state_log_id, patient_id } of unlinkedMatches) {
      if (!patientIdsByStateLogId.has(state_log_id)) patientIdsByStateLogId.set(state_log_id, []);
      patientIdsByStateLogId.get(state_log_id).push(patient_id);
    }
    for (const [stateLogId, matchedPatientIds] of patientIdsByStateLogId) {
      const [firstPatientId, ...restPatientIds] = matchedPatientIds;
      await pool.query('UPDATE compliance_state_logs SET patient_id = $1 WHERE id = $2', [firstPatientId, stateLogId]);
      for (const patientId of restPatientIds) {
        await pool.query(
          `INSERT INTO compliance_state_logs
             (patient_id, child_id, child_name, practitioner_name, service_label, service_type_label,
              group_size_label, location_label, service_date, start_time, end_time, service_minutes,
              logged_date, ifsp_event_id, mapped_service_code, mapped_location_code, mapped_group_size_code,
              period_start, period_end, extra_fields)
           SELECT $1, child_id, child_name, practitioner_name, service_label, service_type_label,
              group_size_label, location_label, service_date, start_time, end_time, service_minutes,
              logged_date, ifsp_event_id, mapped_service_code, mapped_location_code, mapped_group_size_code,
              period_start, period_end, extra_fields
           FROM compliance_state_logs WHERE id = $2`,
          [patientId, stateLogId]
        );
      }
    }

    const patientIds = [...new Set(sessions.map((s) => s.patient_id).filter(Boolean))];
    const { rows: rawStateLogs } = await pool.query(
      `SELECT * FROM compliance_state_logs
       WHERE patient_id = ANY($1::int[])
         AND ($2::date IS NULL OR service_date >= $2)
         AND ($3::date IS NULL OR service_date <= $3)
       ORDER BY service_date ASC`,
      [patientIds, startDate || null, endDate || null]
    );

    // A patient can be seen by more than one practitioner — a state row for
    // that patient only belongs to THIS practitioner's Compliance Analysis
    // if the state record's own practitioner name is actually them (same
    // token-wise name comparison used per-field below), not just "same
    // patient." Without this, another practitioner's sessions for a shared
    // patient showed up here as if this practitioner failed to log them.
    const ourPractitionerNameForFilter = [sessions[0]?.practitioner_first_name, sessions[0]?.practitioner_last_name].filter(Boolean).join(' ');
    const stateLogs = rawStateLogs.filter((log) => (
      !!log.practitioner_name && scoredNamesMatch(ourPractitionerNameForFilter, log.practitioner_name, matchParams.wordOverlapThreshold)
    ));

    // Group state rows AND sessions by patient_id + service_date so a
    // same-day group with several sessions and several candidates gets
    // assigned as a whole via assignGroupCandidates (see its comment) —
    // never one session at a time, which is what let processing order
    // determine the outcome. `date` columns come back as plain 'YYYY-MM-DD'
    // strings, not JS Date objects — see the DATE type parser override in
    // config/db.js — so these are compared as strings.
    const stateByKey = new Map();
    for (const log of stateLogs) {
      const key = `${log.patient_id}:${log.service_date}`;
      if (!stateByKey.has(key)) stateByKey.set(key, []);
      stateByKey.get(key).push(log);
    }
    const sessionsByKey = new Map();
    for (const session of sessions) {
      const key = `${session.patient_id}:${session.service_date}`;
      if (!sessionsByKey.has(key)) sessionsByKey.set(key, []);
      sessionsByKey.get(key).push(session);
    }
    const matchBySessionId = new Map();
    for (const [key, groupSessions] of sessionsByKey) {
      const groupCandidates = stateByKey.get(key) || [];
      const assignment = assignGroupCandidates(groupSessions, groupCandidates);
      for (const [sessionId, candidate] of assignment) matchBySessionId.set(sessionId, candidate);
    }

    const overridesByField = await loadOverridesByField();
    const ackByKey = await loadAcknowledgments(sessions.map((s) => s.id));

    const results = {};
    for (const session of sessions) {
      const match = matchBySessionId.get(session.id) || null;

      const fields = buildFieldsForSession(session, match, { customFieldsByLabel, mappedKeys, matchParams, overridesByField, ackByKey });
      const flagged = fields.some((f) => f.match === false);

      results[session.id] = {
        matched: !!match,
        flagged,
        stateLog: match ? {
          child_name: match.child_name,
          practitioner_name: match.practitioner_name,
          logged_date: match.logged_date,
          ifsp_event_id: match.ifsp_event_id,
        } : null,
        fields,
        eimsMissingStatus: session.eims_missing_status || null,
      };
    }

    // A duplicate log (same patient/date/time/type/location submitted
    // twice) only ever has ONE state record to match against — the group
    // assignment above gives that one candidate to whichever duplicate
    // scores best, leaving the other with no candidate at all. That's not
    // genuinely "missing from the state," it's our own duplicate, so flag
    // it as such instead of implying the state never recorded the session.
    for (const session of sessions) {
      const result = results[session.id];
      if (result.matched) continue;
      const duplicateOf = sessions.find((other) =>
        other.id !== session.id
        && other.patient_id === session.patient_id
        && other.service_date === session.service_date
        && other.start_time === session.start_time
        && other.end_time === session.end_time
        && other.type === session.type
        && other.location === session.location
        && results[other.id]?.matched
      );
      if (duplicateOf) {
        result.duplicateOfSessionId = duplicateOf.id;
        // Whether the message should say "already invoiced, this one won't
        // be paid" vs "duplicates another log in this batch" — an in-batch
        // pairing can itself involve an already-invoiced sibling (sessions
        // here aren't restricted to pending only), so this must reflect the
        // matched session's actual current status, not just which loop
        // found it.
        result.duplicateOfInvoiced = duplicateOf.billing_status === 'invoiced';
        result.flagged = true;
      }
    }

    // A session can also duplicate a log that was ALREADY invoiced in a
    // different batch/period entirely — e.g. logged twice weeks apart under
    // two spellings of the same child's name. That record settled the
    // matter already and won't be in `sessions` at all if it falls outside
    // the currently-selected date range, so it needs its own lookup rather
    // than reusing the in-batch comparison above. Unlike the in-batch case,
    // there's no ambiguity about which side "wins" — an already-invoiced
    // record is definitionally the real one, regardless of whether this
    // session would otherwise have matched the state document on its own.
    //
    // Deliberately NOT filtered on `!matched` — each analysis call re-runs
    // its own independent EIMS matching with no memory of what a *different*
    // earlier call already matched, so a duplicate can easily show "Match"
    // here on its own merits even though its sibling from another batch
    // already claimed that exact same real-world visit. Only sessions
    // already flagged by the in-batch check above are skipped, to avoid
    // redundant work.
    const stillUnresolved = sessions.filter((s) => !results[s.id].duplicateOfSessionId);
    if (stillUnresolved.length > 0) {
      const { rows: historicalInvoiced } = await pool.query(
        `SELECT id, patient_id, service_date, start_time, end_time, type, location
         FROM assessments
         WHERE practitioner_id = $1 AND billing_status = 'invoiced'`,
        [practitionerId]
      );
      for (const session of stillUnresolved) {
        const historicalDuplicate = historicalInvoiced.find((other) =>
          other.id !== session.id
          && other.patient_id === session.patient_id
          && other.service_date === session.service_date
          && other.start_time === session.start_time
          && other.end_time === session.end_time
          && other.type === session.type
          && other.location === session.location
        );
        if (historicalDuplicate) {
          results[session.id].duplicateOfSessionId = historicalDuplicate.id;
          results[session.id].duplicateOfInvoiced = true; // guaranteed by the query's own billing_status = 'invoiced' filter
          results[session.id].flagged = true;
        }
      }
    }

    // For a genuinely unmatched, non-duplicate session, explain WHY no
    // candidate was found — "no EIMS row for this child at all" vs "rows
    // exist but none on this date" vs "a row exists on this date but its
    // practitioner name didn't match" are three very different problems to
    // troubleshoot, and without this a reviewer has no way to tell them
    // apart from the UI alone.
    for (const session of sessions) {
      const result = results[session.id];
      if (result.matched || result.duplicateOfSessionId) continue;
      const childRawLogs = rawStateLogs.filter((log) => log.patient_id === session.patient_id);
      if (childRawLogs.length === 0) {
        result.missingReason = 'No EIMS records on file for this child at all (in the current uploaded reference file).';
      } else {
        const sameDateLogs = childRawLogs.filter((log) => log.service_date === session.service_date);
        if (sameDateLogs.length === 0) {
          const otherDates = [...new Set(childRawLogs.map((log) => log.service_date))].sort();
          result.missingReason = `EIMS has ${childRawLogs.length} record(s) on file for this child, but none dated ${session.service_date}. Other dates on file: ${otherDates.join(', ')}.`;
        } else {
          // Of the same-day, same-child EIMS rows, which ones actually
          // cleared the practitioner-name filter (i.e. were real candidates,
          // not excluded before matching even started)?
          const nameMatchedLogs = sameDateLogs.filter((log) => stateLogs.includes(log));
          if (nameMatchedLogs.length === 0) {
            const stateNames = [...new Set(sameDateLogs.map((log) => log.practitioner_name).filter(Boolean))];
            const ourName = [session.practitioner_first_name, session.practitioner_last_name].filter(Boolean).join(' ');
            result.missingReason = stateNames.length
              ? `EIMS has a record for this child on ${session.service_date}, but it's attributed to "${stateNames.join('", "')}" — didn't match our practitioner name "${ourName}" closely enough.`
              : `EIMS has a record for this child on ${session.service_date}, but its practitioner name field is blank.`;
          } else {
            // A same-day, same-practitioner candidate DID exist — so this
            // isn't a name-matching problem. The likely cause: more of our
            // sessions were logged for this child on this date than EIMS has
            // records for, so assignGroupCandidates (a strict one-to-one
            // pairing) gave the available record(s) to a sibling session
            // instead. Find who actually got it, so the reviewer sees the
            // real cause instead of a misleading name-mismatch message.
            const claimedBy = sessions.find((other) => {
              const otherMatch = matchBySessionId.get(other.id);
              return other.id !== session.id && otherMatch && nameMatchedLogs.includes(otherMatch);
            });
            const siblingCount = sessions.filter((s) => s.patient_id === session.patient_id && s.service_date === session.service_date).length;
            result.missingReason = claimedBy
              ? `EIMS has ${nameMatchedLogs.length} record(s) for this child on ${session.service_date} under the right practitioner, but it was already matched to your other ${claimedBy.start_time || 'session'}${claimedBy.end_time ? `–${claimedBy.end_time}` : ''} log for this child the same day — you logged ${siblingCount} sessions for this child on this date, EIMS only has ${nameMatchedLogs.length}.`
              : `EIMS has a record for this child on ${session.service_date} under the right practitioner, but it didn't line up closely enough on start/end time to be selected as this session's match.`;
          }
        }
      }
    }

    res.json({ success: true, documentOnFile, documentFilename: doc.compliance_doc_filename, strictness: doc.compliance_strictness || 'moderate', results });
  } catch (error) {
    console.error('Error running compliance analysis:', error);
    res.status(500).json({ error: 'Failed to run compliance analysis' });
  }
};

// Single-assessment version of the same comparison, used to (a) gate
// Approve server-side in updateLogStatus, regardless of which UI entry
// point was used, and (b) let allowComplianceField re-derive a field's
// current ours/state values itself rather than trusting the client.
async function computeSessionCompliance(assessmentId) {
  const { rows: docRows } = await pool.query(
    'SELECT compliance_doc_filename, compliance_doc_column_mapping, compliance_doc_path, compliance_doc_applied_path, compliance_doc_custom_fields, compliance_strictness FROM company_settings WHERE id = 1'
  );
  const doc = docRows[0];
  const documentOnFile = !!(
    doc?.compliance_doc_filename
    && doc?.compliance_doc_column_mapping
    && doc?.compliance_doc_applied_path
    && doc.compliance_doc_applied_path === doc.compliance_doc_path
  );
  if (!documentOnFile) return { matched: false, flagged: false, fields: [], documentOnFile: false };

  const { rows: sessionRows } = await pool.query(
    `SELECT assessments.id, patient_id, assessments.practitioner_id, service_date, start_time, end_time, total_time, type, location,
            group_size_category, patient_first_name, patient_last_name,
            practitioner_first_name, practitioner_last_name, completed_at, patients.child_id,
            assessments.status, practitioner_discipline, patient_dob, patient_county,
            eims_missing_status, form_data
     FROM assessments
     LEFT JOIN patients ON patients.id = assessments.patient_id
     WHERE assessments.id = $1`,
    [assessmentId]
  );
  const session = sessionRows[0];
  if (!session) return { matched: false, flagged: false, fields: [], documentOnFile: true };

  // Every other non-declined session this practitioner logged for the same
  // child on the same day. The state-record assignment below MUST be done
  // over this whole group with assignGroupCandidates — exactly like the
  // Compliance Analysis tab's getComplianceAnalysis does — or the two
  // disagree: with two sessions on one day and two matching state rows, the
  // tab pairs them 1-to-1 and shows both clean, while a per-session
  // pickBestCandidate here can hand the closer row to BOTH sessions and
  // then flag phantom time mismatches on one of them, blocking Approve for
  // a log the tab already considers matched.
  const { rows: groupRows } = await pool.query(
    `SELECT assessments.id, patient_id, assessments.practitioner_id, service_date, start_time, end_time, total_time, type, location,
            group_size_category, patient_first_name, patient_last_name,
            practitioner_first_name, practitioner_last_name, completed_at, patients.child_id,
            assessments.status, practitioner_discipline, patient_dob, patient_county,
            eims_missing_status, form_data
     FROM assessments
     LEFT JOIN patients ON patients.id = assessments.patient_id
     WHERE assessments.practitioner_id = $1 AND assessments.patient_id = $2 AND assessments.service_date = $3
       AND assessments.billing_status != 'declined'
     ORDER BY assessments.start_time ASC NULLS LAST, assessments.id ASC`,
    [session.practitioner_id, session.patient_id, session.service_date]
  );
  const groupSessions = groupRows.length > 0 ? groupRows : [session];

  // Same patient/date/time/type/location logged more than once (e.g. under
  // a spelling variant of the child's name) can independently show a clean
  // "Match" here — this check has no memory of any OTHER assessment that
  // already claimed the same real-world visit, in this call or a past one.
  // Block on an explicit duplicate lookup rather than trusting matched/
  // flagged alone, the same gap that let a duplicate slip through Session
  // Detail's Approve button despite Compliance Analysis's own duplicate
  // detection (a separate code path from this one).
  const { rows: duplicateRows } = await pool.query(
    `SELECT id, billing_status FROM assessments
     WHERE practitioner_id = $1 AND patient_id = $2 AND service_date = $3
       AND start_time IS NOT DISTINCT FROM $4 AND end_time IS NOT DISTINCT FROM $5
       AND type = $6 AND location = $7
       AND id != $8 AND billing_status != 'declined'
     ORDER BY (billing_status = 'invoiced') DESC
     LIMIT 1`,
    [session.practitioner_id, session.patient_id, session.service_date, session.start_time, session.end_time, session.type, session.location, assessmentId]
  );
  const duplicateOfSessionId = duplicateRows[0]?.id || null;
  const duplicateOfInvoiced = duplicateRows[0]?.billing_status === 'invoiced';

  const matchParams = resolveStrictnessProfile(doc.compliance_strictness);
  const { rows: rawStateLogs } = await pool.query(
    'SELECT * FROM compliance_state_logs WHERE patient_id = $1 AND service_date = $2',
    [session.patient_id, session.service_date]
  );
  const ourPractitionerNameForFilter = [session.practitioner_first_name, session.practitioner_last_name].filter(Boolean).join(' ');
  const stateLogs = rawStateLogs.filter((log) => (
    !!log.practitioner_name && scoredNamesMatch(ourPractitionerNameForFilter, log.practitioner_name, matchParams.wordOverlapThreshold)
  ));

  const match = assignGroupCandidates(groupSessions, stateLogs).get(Number(assessmentId)) || null;
  const customFieldsByLabel = new Map((doc?.compliance_doc_custom_fields || []).map((cf) => [cf.label, cf]));
  const mappedKeys = new Set(Object.entries(doc?.compliance_doc_column_mapping || {}).filter(([, header]) => header).map(([key]) => key));
  const overridesByField = await loadOverridesByField();
  const ackByKey = await loadAcknowledgments([assessmentId]);

  const fields = buildFieldsForSession(session, match, { customFieldsByLabel, mappedKeys, matchParams, overridesByField, ackByKey });
  const flagged = fields.some((f) => f.match === false);
  return { matched: !!match, flagged, fields, documentOnFile: true, eimsMissingStatus: session.eims_missing_status || null, duplicateOfSessionId, duplicateOfInvoiced };
}

// --- 10. Fetch logs for a completed vault entry (by practitioner name + date range) ---
const getVaultLogs = async (req, res) => {
  const { practitionerFolder, startDate, endDate, isOverride, batchId } = req.query;
  if (!practitionerFolder || (!batchId && (!startDate || !endDate))) {
    return res.status(400).json({ error: 'practitionerFolder and either batchId or startDate+endDate are required' });
  }
  try {
    const selectCols = `id, billing_status, billing_review, service_date, status, type, location, start_time, end_time, total_time, patient_first_name, patient_last_name, group_size_category, form_data`;
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
             EXISTS (
               SELECT 1 FROM assessments a WHERE a.billing_batch_id = b.id AND a.billing_status = 'invoiced'
             ) AS completed,
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
// assessment back to billing_status='pending' with billing_review cleared (so
// it shows as Pending, not still Approved), and removes the billing_batches row.
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
      "UPDATE assessments SET billing_status = 'pending', billing_review = NULL, billing_batch_id = NULL WHERE billing_batch_id = $1 RETURNING id",
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
    res.status(500).json({ success: false, error: 'Failed to revert batch' });
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

// Lightweight single-session compliance status, used by SessionDetailPanel
// (the Session Detail tab) to gate its own Approve button the same way the
// Compliance Analysis tab does, without needing the whole batch's `analysis`
// state lifted or re-fetched there.
const getSessionComplianceStatus = async (req, res) => {
  const { assessmentId } = req.query;
  if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });
  try {
    const compliance = await computeSessionCompliance(assessmentId);
    res.json({
      success: true,
      documentOnFile: compliance.documentOnFile,
      matched: compliance.matched,
      flagged: compliance.flagged,
      eimsMissingStatus: compliance.eimsMissingStatus || null,
      duplicateOfSessionId: compliance.duplicateOfSessionId || null,
      duplicateOfInvoiced: !!compliance.duplicateOfInvoiced,
    });
  } catch (error) {
    console.error('Error fetching session compliance status:', error);
    res.status(500).json({ error: 'Failed to fetch compliance status' });
  }
};

// Billing sends a "Missing in EIMS" log to an admin for review instead of
// being able to approve it directly — step 1 of the send-to-admin workflow.
// An optional note goes into the same assessment_notes thread every other
// log comment uses, so it shows up wherever those already surface (the
// notes icon in the queue, Master Reports' notes modal).
const sendMissingToAdmin = async (req, res) => {
  const { assessmentId, note } = req.body;
  if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

  try {
    const compliance = await computeSessionCompliance(assessmentId);
    if (compliance.matched) {
      return res.status(400).json({ error: 'This log has a matching state record — it doesn\'t need admin review.' });
    }
    if (compliance.eimsMissingStatus === 'sent_to_admin') {
      return res.status(400).json({ error: 'This log has already been sent to an admin for review.' });
    }

    await pool.query(
      `UPDATE assessments
       SET eims_missing_status = 'sent_to_admin', eims_missing_sent_by = $1, eims_missing_sent_at = now(),
           eims_missing_decided_by = NULL, eims_missing_decided_at = NULL
       WHERE id = $2`,
      [req.practitioner.practitionerId, assessmentId]
    );
    if (note && note.trim()) {
      await pool.query(
        `INSERT INTO assessment_notes (assessment_id, author_id, author_role, note)
         VALUES ($1, $2, $3, $4)`,
        [assessmentId, req.practitioner.practitionerId, req.practitioner.role, note.trim()]
      );
    }
    logAudit({ req, action: 'missing_in_eims_sent_to_admin', resourceType: 'assessment', resourceId: assessmentId });
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending missing-in-EIMS log to admin:', error);
    res.status(500).json({ error: 'Failed to send log to admin' });
  }
};

// Ceo's "Action Required" queue — every log currently awaiting an admin
// decision, across all practitioners, newest-sent first.
const getActionRequiredLogs = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.service_date, a.start_time, a.end_time, a.total_time,
              a.type, a.location, a.status, a.group_size_category, a.form_data,
              a.patient_id, patients.child_id, a.patient_first_name, a.patient_last_name,
              a.patient_dob, a.patient_county,
              a.practitioner_first_name, a.practitioner_last_name, a.practitioner_discipline,
              a.eims_missing_sent_at,
              sender.first_name AS sent_by_first_name, sender.last_name AS sent_by_last_name
       FROM assessments a
       LEFT JOIN patients ON patients.id = a.patient_id
       LEFT JOIN practitioners sender ON sender.id = a.eims_missing_sent_by
       WHERE a.eims_missing_status = 'sent_to_admin'
       ORDER BY a.eims_missing_sent_at ASC`
    );
    res.json({ success: true, logs: rows });
  } catch (error) {
    console.error('Error fetching action-required logs:', error);
    res.status(500).json({ error: 'Failed to fetch action-required logs' });
  }
};

// Approves or rejects a "Missing in EIMS" log — either the ceo deciding
// from their own Action Required queue, or (as of the direct-decide option
// added to Session Detail) anyone with Pending Bills access deciding it
// themselves instead of only being able to escalate via Send to Admin.
// A comment is optional for an approval (there's nothing left to explain —
// the reviewer already saw the missing-record disclaimer and chose to
// approve anyway) but still required for a reject, same as every other
// reject/return path in this app, so the practitioner/billing has a reason
// to act on. The comment, when given, goes into the same assessment_notes
// thread as every other log comment. A reject also declines the log
// outright (mirrors rejectLog's permanent-reject path) — a rejected
// "missing in EIMS" log was never going to become billable, so there's
// nothing left to leave it pending for.
const decideMissingInEims = async (req, res) => {
  const { assessmentId, decision, comment } = req.body;
  if (!assessmentId || !['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'assessmentId and a valid decision (approved | rejected) are required' });
  }
  if (decision === 'rejected' && !comment?.trim()) {
    return res.status(400).json({ error: 'A comment is required to reject this log.' });
  }

  try {
    const compliance = await computeSessionCompliance(assessmentId);
    if (compliance.matched) {
      return res.status(400).json({ error: 'This log has a matching state record — it doesn\'t need admin review.' });
    }

    await pool.query(
      `UPDATE assessments
       SET eims_missing_status = $1, eims_missing_decided_by = $2, eims_missing_decided_at = now()
       WHERE id = $3`,
      [decision, req.practitioner.practitionerId, assessmentId]
    );

    if (decision === 'rejected') {
      const { rows: currentRows } = await pool.query('SELECT rejection_count FROM assessments WHERE id = $1', [assessmentId]);
      await pool.query(
        `UPDATE assessments
         SET billing_status = 'declined', billing_review = 'reject', rejection_note = $1, rejected_at = now(), rejection_count = $2
         WHERE id = $3`,
        [comment.trim(), (currentRows[0]?.rejection_count || 0) + 1, assessmentId]
      );
    }

    if (comment?.trim()) {
      await pool.query(
        `INSERT INTO assessment_notes (assessment_id, author_id, author_role, note)
         VALUES ($1, $2, $3, $4)`,
        [assessmentId, req.practitioner.practitionerId, req.practitioner.role, comment.trim()]
      );
    }

    logAudit({ req, action: `missing_in_eims_${decision}`, resourceType: 'assessment', resourceId: assessmentId, details: { comment: comment?.trim() || null } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deciding missing-in-EIMS log:', error);
    res.status(500).json({ error: 'Failed to record decision' });
  }
};

module.exports = {
  getPendingLogs,
  generateNJEISForms,
  generateFinancialInvoice,
  completeBilling,
  getInvoiceHistory,
  getInvoiceDownloadUrl,
  getMyInvoices,
  getMyInvoiceDownloadUrl,
  getPractitionerLogs,
  getLogNotes,
  getComplianceAnalysis,
  updateLogStatus,
  rejectLog,
  reconcileLog,
  addLogComment,
  getVaultLogs,
  getBillingBatches,
  revertBillingBatch,
  markBatchPrinted,
  markBatchPaid,
  lockPractitioner,
  unlockPractitioner,
  computeSessionCompliance,
  getSessionComplianceStatus,
  sendMissingToAdmin,
  getActionRequiredLogs,
  decideMissingInEims,
};
