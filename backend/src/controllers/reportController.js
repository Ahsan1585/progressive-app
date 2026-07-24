const { pool } = require('../config/db');
const {
  NJEIS_FORMS_BUCKET,
  BILLING_INVOICES_BUCKET,
  uploadFile,
  getSignedUrl,
} = require('../config/storage');
const { generateNjeisPDF } = require('../utils/njeisGenerator');
const { generateInvoicePDF } = require('../utils/invoiceGenerator');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const ExcelJS = require('exceljs');

// Converts a 24-hour "HH:MM" string into 12-hour AM/PM format for report display.
const formatTime12h = (timeStr) => {
  if (!timeStr) return '';
  const [hourStr, minuteStr] = String(timeStr).split(':');
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return timeStr;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${(minuteStr || '00').padStart(2, '0')} ${period}`;
};

// 1. Logic to generate the Master Report
const generateMasterReport = async (req, res) => {
  const { practitionerId, targetMonth, targetYear } = req.body;

  try {
    const { rows: practitionerRows } = await pool.query(
      'SELECT * FROM practitioners WHERE id = $1',
      [practitionerId]
    );
    const practitioner = practitionerRows[0];
    if (!practitioner) throw new Error('Practitioner not found');

    const parsedPractitionerId = parseInt(practitionerId, 10);

    const { rows: pendingEncounters } = await pool.query(
      "SELECT * FROM assessments WHERE practitioner_id = $1 AND billing_status = 'pending'",
      [parsedPractitionerId]
    );

    if (!pendingEncounters || pendingEncounters.length === 0) {
      return res.status(404).json({ error: 'No pending encounters found.' });
    }

    // 1. Group by the actual first and last name columns and capture the patient_id
    const encountersByChild = pendingEncounters.reduce((acc, encounter) => {
      const firstName = encounter.patient_first_name || '';
      const lastName = encounter.patient_last_name || '';
      const childName = `${firstName} ${lastName}`.trim() || 'Unknown Child';

      if (!acc[childName]) {
        acc[childName] = { patientId: encounter.patient_id, encounters: [] };
      }
      acc[childName].encounters.push(encounter);
      return acc;
    }, {});

    const createdReports = [];

    // 2. Loop through the properly grouped data
    for (const [childName, group] of Object.entries(encountersByChild)) {
      const encounters = group.encounters;
      const patientId = group.patientId;

      // Calculate hours by dividing the total_time (minutes) by 60
      const totalHours = encounters.reduce((sum, record) => sum + (parseFloat(record.total_time || 0) / 60), 0);
      const encounterIds = encounters.map(e => e.id);

      // 🌟 Fetch the full patient record from the database to get DOB, County, and Child ID
      let patientData = null;
      if (patientId) {
        try {
          const { rows: pRows } = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
          patientData = pRows[0] || null;
        } catch (pError) {
          console.warn(`Could not fetch patient details for ID ${patientId}:`, pError.message);
        }
      }

      // Merge the official patient table data with fallbacks
      const childData = {
        first_name: patientData?.first_name || childName.split(' ')[0] || '',
        last_name: patientData?.last_name || childName.split(' ').slice(1).join(' ') || '',
        middle_name: patientData?.middle_name || '',
        dob: patientData?.dob || '',
        county: patientData?.county || '',
        child_id: patientData?.child_id || 'N/A' // Official NJEIS ID
      };

      // 🌟 Pass the enriched childData to the generator
      const pdfBuffer = await generateNjeisPDF(
        practitioner,
        childData,
        encounters,
        `${targetMonth}/${targetYear}`
      );

      const fileName = `${practitionerId}/${childName}-${Date.now()}.pdf`.replace(/\s+/g, '_');
      await uploadFile(NJEIS_FORMS_BUCKET, fileName, pdfBuffer, 'application/pdf');

      // 3. Insert into master_reports with the correct patientId and calculated hours
      const { rows: newReportRows } = await pool.query(
        `INSERT INTO master_reports
           (practitioner_id, patient_id, child_name, date_range, total_hours, included_assessment_ids, njeis_pdf_path, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_approval')
         RETURNING *`,
        [practitionerId, patientId, childName, `${targetMonth}/${targetYear}`, totalHours, JSON.stringify(encounterIds), fileName]
      );
      const newReport = newReportRows[0];

      // 4. Lock the individual encounters using the new admin column
      await pool.query(
        "UPDATE assessments SET billing_status = 'locked_in_report' WHERE id = ANY($1::int[])",
        [encounterIds]
      );

      createdReports.push(newReport);
    }

    res.status(201).json({ success: true, message: `Generated ${createdReports.length} reports.`, reports: createdReports });
  } catch (error) {
    console.error('Master Report Error:', error);
    res.status(500).json({ error: 'Failed to generate Master Reports.' });
  }
};

// 2. Logic to fetch pending reports for the admin queue
const getPendingReports = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name) AS practitioners
      FROM master_reports r
      JOIN practitioners p ON p.id = r.practitioner_id
      WHERE r.status = 'pending_approval'
    `);
    res.json({ success: true, pendingReports: rows });
  } catch (error) {
    console.error('Error fetching pending reports:', error);
    res.status(500).json({ error: 'Failed to fetch pending reports.' });
  }
};

// Resolves a practitioner name search term into matching practitioner IDs,
// or a single numeric ID if the term itself is numeric.
const resolvePractitionerIds = async (practitionerSearch) => {
  const term = practitionerSearch.trim();
  const asNum = parseInt(term);
  if (!isNaN(asNum)) return [asNum];

  const { rows } = await pool.query(
    'SELECT id FROM practitioners WHERE first_name ILIKE $1 OR last_name ILIKE $1',
    [`%${term}%`]
  );
  return rows.map(p => p.id);
};

// 3. Flexible audit query — filters by practitioner name/id, patient name, date range, billing status
const getAuditLogs = async (req, res) => {
  const { practitionerSearch, patientSearch, startDate, endDate, billingStatus, compliance } = req.query;

  try {
    let practitionerIds = null;
    if (practitionerSearch && practitionerSearch.trim()) {
      practitionerIds = await resolvePractitionerIds(practitionerSearch);
      if (practitionerIds.length === 0) return res.json({ success: true, logs: [] });
    }

    const params = [];
    let sql = `
      SELECT a.id, a.service_date, a.status, a.type, a.location, a.start_time, a.end_time, a.total_time,
             a.billing_status, a.billing_review, a.patient_first_name, a.patient_last_name, a.patient_id,
             a.practitioner_id, a.acknowledged_at, a.practitioner_response, a.responded_at, a.rejection_count,
             jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'position_title', p.position_title) AS practitioners
      FROM assessments a
      JOIN practitioners p ON p.id = a.practitioner_id
      WHERE 1=1
    `;

    if (startDate) { params.push(startDate); sql += ` AND a.service_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND a.service_date <= $${params.length}`; }

    if (compliance === 'true') {
      // Compliance mode: logs > 30 days old still in pending/njeis_review
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - 30);
      const thresholdDate = threshold.toISOString().split('T')[0];
      if (!endDate) { params.push(thresholdDate); sql += ` AND a.service_date <= $${params.length}`; }
      params.push(['pending', 'njeis_review']);
      sql += ` AND a.billing_status = ANY($${params.length}::text[])`;
    } else if (billingStatus && billingStatus !== 'all') {
      params.push(billingStatus); sql += ` AND a.billing_status = $${params.length}`;
    }

    if (practitionerIds) { params.push(practitionerIds); sql += ` AND a.practitioner_id = ANY($${params.length}::int[])`; }
    if (patientSearch && patientSearch.trim()) {
      const term = patientSearch.trim();
      params.push(`%${term}%`);
      sql += ` AND (a.patient_first_name ILIKE $${params.length} OR a.patient_last_name ILIKE $${params.length})`;
    }

    sql += ' ORDER BY a.service_date DESC LIMIT 1000';

    const { rows: logs } = await pool.query(sql, params);
    res.json({ success: true, logs: logs || [] });
  } catch (error) {
    console.error('getAuditLogs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

// 3b. Org-wide patient roster — every patient any practitioner has registered
const getAllPatients = async (req, res) => {
  const { practitionerSearch, patientSearch, status } = req.query;

  try {
    let practitionerIds = null;
    if (practitionerSearch && practitionerSearch.trim()) {
      practitionerIds = await resolvePractitionerIds(practitionerSearch);
      if (practitionerIds.length === 0) return res.json({ success: true, patients: [] });
    }

    const params = [];
    let sql = `
      SELECT pt.id, pt.first_name, pt.middle_name, pt.last_name, pt.dob, pt.county, pt.child_id,
             pt.status, pt.created_at, pt.practitioner_id,
             jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name) AS practitioners
      FROM patients pt
      JOIN practitioners p ON p.id = pt.practitioner_id
      WHERE 1=1
    `;

    if (status && status !== 'all') { params.push(status); sql += ` AND pt.status = $${params.length}`; }
    if (practitionerIds) { params.push(practitionerIds); sql += ` AND pt.practitioner_id = ANY($${params.length}::int[])`; }
    if (patientSearch && patientSearch.trim()) {
      const term = patientSearch.trim();
      params.push(`%${term}%`);
      sql += ` AND (pt.first_name ILIKE $${params.length} OR pt.last_name ILIKE $${params.length} OR pt.child_id ILIKE $${params.length})`;
    }

    sql += ' ORDER BY pt.created_at DESC LIMIT 2000';

    const { rows: patients } = await pool.query(sql, params);
    res.json({ success: true, patients: patients || [] });
  } catch (error) {
    console.error('getAllPatients error:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
};

// 4. Generate merged NJEIS PDF from audit query — one form per (practitioner, child) pair, 10 rows per page
const generateAuditNJEIS = async (req, res) => {
  const { practitionerSearch, patientSearch, startDate, endDate, billingStatus } = req.body;

  try {
    let practitionerIds = null;
    if (practitionerSearch && practitionerSearch.trim()) {
      practitionerIds = await resolvePractitionerIds(practitionerSearch);
      if (practitionerIds.length === 0) return res.status(404).json({ error: 'No matching practitioners found' });
    }

    const params = [];
    let sql = `
      SELECT a.id, a.service_date, a.status, a.type, a.location, a.start_time, a.end_time, a.total_time,
             a.billing_status, a.patient_first_name, a.patient_last_name, a.patient_id,
             a.practitioner_id, a.parent_signature, a.practitioner_signature,
             jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'position_title', p.position_title) AS practitioners
      FROM assessments a
      JOIN practitioners p ON p.id = a.practitioner_id
      WHERE a.billing_status NOT IN ('rejected', 'declined')
    `;

    if (startDate) { params.push(startDate); sql += ` AND a.service_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND a.service_date <= $${params.length}`; }
    if (billingStatus && billingStatus !== 'all') { params.push(billingStatus); sql += ` AND a.billing_status = $${params.length}`; }
    if (practitionerIds) { params.push(practitionerIds); sql += ` AND a.practitioner_id = ANY($${params.length}::int[])`; }
    if (patientSearch && patientSearch.trim()) {
      const term = patientSearch.trim();
      params.push(`%${term}%`);
      sql += ` AND (a.patient_first_name ILIKE $${params.length} OR a.patient_last_name ILIKE $${params.length})`;
    }

    sql += ' ORDER BY a.service_date ASC LIMIT 1000';

    const { rows: logs } = await pool.query(sql, params);
    if (!logs || logs.length === 0) return res.status(404).json({ error: 'No logs found for the given filters' });

    // Group by (practitioner_id, patient_id) — keeps NJEIS header info consistent per form
    const groups = {};
    for (const log of logs) {
      const childKey = log.patient_id || `${log.patient_first_name}_${log.patient_last_name}`;
      const key = `${log.practitioner_id}||${childKey}`;
      if (!groups[key]) {
        groups[key] = { logs: [], practitioner: log.practitioners, patientId: log.patient_id, firstName: log.patient_first_name, lastName: log.patient_last_name };
      }
      groups[key].logs.push(log);
    }

    const mergedDoc = await PDFDocument.create();
    const ROWS_PER_PAGE = 10;

    for (const group of Object.values(groups)) {
      // Fetch full patient record for DOB, county, official child_id
      let patientData = { first_name: group.firstName || '', last_name: group.lastName || '', middle_name: '', dob: '', county: '', child_id: 'N/A' };
      if (group.patientId) {
        const { rows: pRows } = await pool.query('SELECT * FROM patients WHERE id = $1', [group.patientId]);
        const pData = pRows[0];
        if (pData) {
          patientData = {
            first_name: pData.first_name || patientData.first_name,
            last_name: pData.last_name || patientData.last_name,
            middle_name: pData.middle_name || '',
            dob: pData.dob || '',
            county: pData.county || '',
            child_id: pData.child_id || 'N/A'
          };
        }
      }

      const practitionerObj = {
        first_name: group.practitioner?.first_name || '',
        last_name: group.practitioner?.last_name || '',
        position_title: group.practitioner?.position_title || ''
      };

      // MonthYear from first encounter's date
      const firstDate = group.logs[0]?.service_date || startDate || '';
      const [fy, fm] = firstDate.split('-');
      const targetMonthYear = fy && fm ? `${fm}/${fy}` : '';

      // Chunk encounters into pages of 10 rows each
      for (let i = 0; i < group.logs.length; i += ROWS_PER_PAGE) {
        const chunk = group.logs.slice(i, i + ROWS_PER_PAGE);
        const pdfBuffer = await generateNjeisPDF(practitionerObj, patientData, chunk, targetMonthYear);
        const pageDoc = await PDFDocument.load(pdfBuffer);
        const [copiedPage] = await mergedDoc.copyPages(pageDoc, [0]);
        mergedDoc.addPage(copiedPage);
      }
    }

    const mergedBytes = await mergedDoc.save();

    // Upload to audit subfolder in njeis-forms bucket
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');
    const fileName = `audit/AUDIT_NJEIS_${ts}.pdf`;

    await uploadFile(NJEIS_FORMS_BUCKET, fileName, Buffer.from(mergedBytes), 'application/pdf');

    const signedUrl = await getSignedUrl(NJEIS_FORMS_BUCKET, fileName, 3600);

    res.json({ success: true, downloadUrl: signedUrl, pageCount: mergedDoc.getPageCount() });
  } catch (error) {
    console.error('generateAuditNJEIS error:', error);
    res.status(500).json({ error: 'Failed to generate audit SEVF forms' });
  }
};

// 5. Generate a printable PDF summary report via Puppeteer (logs passed from frontend)
const generateAuditReportPDF = async (req, res) => {
  const { logs, filters } = req.body;
  if (!logs || !Array.isArray(logs)) return res.status(400).json({ error: 'logs array required' });

  const totalHours = (logs.reduce((sum, l) => sum + (l.total_time || 0), 0) / 60).toFixed(1);
  const uniqueChildren = new Set(logs.map(l => l.patient_id || `${l.patient_first_name}_${l.patient_last_name}`)).size;
  const uniquePractitioners = new Set(logs.map(l => l.practitioner_id)).size;

  const statusLabel = { pending: 'Pending', njeis_review: 'In Review', invoiced: 'Invoiced', declined: 'Rejected', rejected: 'Returned' };
  const statusColor = {
    invoiced: rgb(0.02, 0.4, 0.35), pending: rgb(0.65, 0.32, 0.02),
    njeis_review: rgb(0.05, 0.29, 0.63), declined: rgb(0.6, 0.06, 0.06), rejected: rgb(0.31, 0.18, 0.53),
  };
  const filterLine = [
    filters?.startDate && `Date: ${filters.startDate} -> ${filters.endDate || 'present'}`,
    filters?.practitionerSearch && `Practitioner: ${filters.practitionerSearch}`,
    filters?.patientSearch && `Patient: ${filters.patientSearch}`,
    filters?.billingStatus && filters.billingStatus !== 'all' && `Status: ${filters.billingStatus}`
  ].filter(Boolean).join('   |   ');

  const rows = logs.map(l => {
    const [y, m, d] = (l.service_date || '').split('-');
    const dateStr = y ? `${parseInt(m)}/${parseInt(d)}/${y.slice(-2)}` : '-';
    return {
      cells: [
        `${l.patient_first_name || ''} ${l.patient_last_name || ''}`.trim() || '-',
        `${l.practitioners?.first_name || ''} ${l.practitioners?.last_name || ''}`.trim() || '-',
        dateStr,
        l.type || '-',
        l.location || '-',
        l.start_time ? formatTime12h(l.start_time) : '-',
        l.end_time ? formatTime12h(l.end_time) : '-',
        l.total_time ? `${(l.total_time / 60).toFixed(2)}h` : '-',
        statusLabel[l.billing_status] || l.billing_status || '-',
      ],
      statusKey: l.billing_status,
    };
  });

  const pageSize = { width: 842, height: 595 }; // A4 landscape (points)
  const margin = 34;
  const contentWidth = pageSize.width - margin * 2;

  const cols = [
    { label: 'Patient Name',  w: 130 },
    { label: 'Practitioner',  w: 120 },
    { label: 'Service Date',  w: 78  },
    { label: 'Type',          w: 90  },
    { label: 'Location',      w: 90  },
    { label: 'Start',         w: 62  },
    { label: 'End',           w: 62  },
    { label: 'Time',          w: 62  },
    { label: 'Status',        w: 80  },
  ];

  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const rowH = 16;
  const headerH = 18;
  const black = rgb(0.12, 0.16, 0.22);
  const gray  = rgb(0.4, 0.46, 0.55);
  const lightGray = rgb(0.97, 0.98, 0.99);

  const drawTableHeader = (page, y) => {
    page.drawRectangle({ x: margin, y: y - headerH, width: contentWidth, height: headerH, color: black });
    let cx = margin;
    cols.forEach(col => {
      page.drawText(col.label.toUpperCase(), { x: cx + 4, y: y - headerH + 6, font: bold, size: 7, color: rgb(1,1,1) });
      cx += col.w;
    });
    return y - headerH;
  };

  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = pageSize.height - margin;

  // ── Header ──
  page.drawText('Progressive Steps NJ - Audit Report', { x: margin, y, font: bold, size: 15, color: black });
  const genLabel = `Generated: ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`;
  const genW = regular.widthOfTextAtSize(genLabel, 9);
  page.drawText(genLabel, { x: pageSize.width - margin - genW, y: y + 2, font: regular, size: 9, color: gray });
  y -= 14;
  page.drawText('System Audit & Reports', { x: margin, y, font: regular, size: 9, color: gray });
  const recLabel = `${logs.length} records`;
  const recW = regular.widthOfTextAtSize(recLabel, 9);
  page.drawText(recLabel, { x: pageSize.width - margin - recW, y, font: regular, size: 9, color: gray });
  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: pageSize.width - margin, y }, thickness: 1.5, color: black });
  y -= 16;

  // ── Filter line ──
  if (filterLine) {
    const filterBoxH = 18;
    page.drawRectangle({ x: margin, y: y - filterBoxH, width: contentWidth, height: filterBoxH, color: lightGray, borderColor: rgb(0.89,0.91,0.94), borderWidth: 0.5 });
    page.drawText('Filters applied: ', { x: margin + 6, y: y - filterBoxH + 6, font: bold, size: 8, color: rgb(0.28,0.34,0.42) });
    const labelW = bold.widthOfTextAtSize('Filters applied: ', 8);
    page.drawText(filterLine, { x: margin + 6 + labelW, y: y - filterBoxH + 6, font: regular, size: 8, color: rgb(0.28,0.34,0.42) });
    y -= filterBoxH + 12;
  }

  // ── Stat boxes ──
  const stats = [
    { label: 'Total Logs',      value: `${logs.length}` },
    { label: 'Total Hours',     value: `${totalHours}h` },
    { label: 'Unique Patients', value: `${uniqueChildren}` },
    { label: 'Practitioners',   value: `${uniquePractitioners}` },
  ];
  const statBoxH = 36;
  const statGap = 10;
  const statW = (contentWidth - statGap * (stats.length - 1)) / stats.length;
  let sx = margin;
  stats.forEach(s => {
    page.drawRectangle({ x: sx, y: y - statBoxH, width: statW, height: statBoxH, color: rgb(0.945,0.96,0.97) });
    const valW = bold.widthOfTextAtSize(s.value, 15);
    page.drawText(s.value, { x: sx + (statW - valW) / 2, y: y - 18, font: bold, size: 15, color: black });
    const lblW = regular.widthOfTextAtSize(s.label.toUpperCase(), 7);
    page.drawText(s.label.toUpperCase(), { x: sx + (statW - lblW) / 2, y: y - statBoxH + 8, font: regular, size: 7, color: gray });
    sx += statW + statGap;
  });
  y -= statBoxH + 14;

  // ── Table ──
  y = drawTableHeader(page, y);

  rows.forEach((row, i) => {
    if (y - rowH < margin + 20) {
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - margin;
      page.drawText('Progressive Steps NJ - Audit Report (continued)', { x: margin, y, font: bold, size: 11, color: black });
      y -= 18;
      y = drawTableHeader(page, y);
    }

    if (i % 2 === 1) {
      page.drawRectangle({ x: margin, y: y - rowH, width: contentWidth, height: rowH, color: lightGray });
    }

    let cx = margin;
    row.cells.forEach((val, ci) => {
      const isStatus = ci === row.cells.length - 1;
      const color = isStatus ? (statusColor[row.statusKey] || gray) : rgb(0.2,0.24,0.3);
      const font = isStatus ? bold : regular;
      page.drawText(String(val), { x: cx + 4, y: y - rowH + 5, font, size: 8, color });
      cx += cols[ci].w;
    });
    y -= rowH;
  });

  // ── Footer on last page ──
  page.drawLine({ start: { x: margin, y: margin + 12 }, end: { x: pageSize.width - margin, y: margin + 12 }, thickness: 0.5, color: rgb(0.89,0.91,0.94) });
  const footerText = 'Progressive Steps NJ - Audit Report - Confidential';
  const footerW = regular.widthOfTextAtSize(footerText, 8);
  page.drawText(footerText, { x: (pageSize.width - footerW) / 2, y: margin, font: regular, size: 8, color: rgb(0.58,0.64,0.72) });

  const pdfBytes = await pdfDoc.save();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="audit-report-${ts()}.pdf"`);
  res.send(Buffer.from(pdfBytes));
};

const ts = () => new Date().toISOString().replace(/[-:T.]/g,'').slice(0,14);

// 6. Generate an Excel (.xlsx) summary report from the same audit query results (logs passed from frontend)
const generateAuditReportExcel = async (req, res) => {
  const { logs, filters } = req.body;
  if (!logs || !Array.isArray(logs)) return res.status(400).json({ error: 'logs array required' });

  try {
    const statusLabel = { pending: 'Pending', njeis_review: 'In Review', invoiced: 'Invoiced', declined: 'Rejected', rejected: 'Returned' };

    const filterLine = [
      filters?.startDate && `Date: ${filters.startDate} -> ${filters.endDate || 'present'}`,
      filters?.practitionerSearch && `Practitioner: ${filters.practitionerSearch}`,
      filters?.patientSearch && `Patient: ${filters.patientSearch}`,
      filters?.billingStatus && filters.billingStatus !== 'all' && `Status: ${filters.billingStatus}`
    ].filter(Boolean).join('   |   ');

    const showDaysOld = !!filters?.compliance;

    const columns = [
      { header: 'Patient Name',    key: 'patientName', width: 24 },
      { header: 'Practitioner',    key: 'practitioner', width: 22 },
      { header: 'Service Date',    key: 'serviceDate',  width: 14 },
      { header: 'Service Type',    key: 'type',          width: 16 },
      { header: 'Location',        key: 'location',      width: 16 },
      { header: 'Start',           key: 'start',         width: 12 },
      { header: 'End',             key: 'end',           width: 12 },
      { header: 'Total Time',      key: 'totalTime',     width: 12 },
      { header: 'Billing Status',  key: 'billingStatus', width: 16 },
      { header: 'Comments',        key: 'comments',      width: 32 },
    ];
    if (showDaysOld) columns.push({ header: 'Days Old', key: 'daysOld', width: 10 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Progressive Steps NJ';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Audit Report');

    let rowCursor = 1;
    sheet.mergeCells(rowCursor, 1, rowCursor, columns.length);
    const titleCell = sheet.getCell(rowCursor, 1);
    titleCell.value = 'Progressive Steps NJ - Audit Report';
    titleCell.font = { bold: true, size: 14 };
    rowCursor++;

    sheet.mergeCells(rowCursor, 1, rowCursor, columns.length);
    const metaCell = sheet.getCell(rowCursor, 1);
    metaCell.value = `Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}   |   ${logs.length} records`;
    metaCell.font = { size: 9, color: { argb: 'FF6B7280' } };
    rowCursor++;

    if (filterLine) {
      sheet.mergeCells(rowCursor, 1, rowCursor, columns.length);
      const filterCell = sheet.getCell(rowCursor, 1);
      filterCell.value = `Filters applied: ${filterLine}`;
      filterCell.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
      rowCursor++;
    }

    rowCursor++; // blank spacer row

    // Set widths only (not `key`/`header`) so this doesn't auto-write a header into row 1 and clobber the title above
    columns.forEach((col, i) => { sheet.getColumn(i + 1).width = col.width; });
    const headerRow = sheet.getRow(rowCursor);
    columns.forEach((col, i) => { headerRow.getCell(i + 1).value = col.header; });
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.alignment = { vertical: 'middle' };
    });
    const headerRowNumber = rowCursor;
    rowCursor++;

    logs.forEach((l) => {
      const [y, m, d] = (l.service_date || '').split('-');
      const dateStr = y ? `${parseInt(m)}/${parseInt(d)}/${y.slice(-2)}` : '-';
      const row = sheet.getRow(rowCursor);
      row.getCell(1).value = `${l.patient_first_name || ''} ${l.patient_last_name || ''}`.trim() || '-';
      row.getCell(2).value = `${l.practitioners?.first_name || ''} ${l.practitioners?.last_name || ''}`.trim() || '-';
      row.getCell(3).value = dateStr;
      row.getCell(4).value = l.type || '-';
      row.getCell(5).value = l.location || '-';
      row.getCell(6).value = l.start_time ? formatTime12h(l.start_time) : '-';
      row.getCell(7).value = l.end_time ? formatTime12h(l.end_time) : '-';
      row.getCell(8).value = l.total_time ? `${(l.total_time / 60).toFixed(2)}h` : '-';
      row.getCell(9).value = statusLabel[l.billing_status] || l.billing_status || '-';
      row.getCell(10).value = l.practitioner_response || '-';
      if (showDaysOld) {
        const daysOld = l.service_date
          ? Math.floor((Date.now() - new Date(l.service_date + 'T00:00:00').getTime()) / 86400000)
          : null;
        row.getCell(11).value = daysOld !== null ? `${daysOld}d` : '-';
      }
      rowCursor++;
    });

    sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="audit-report-${ts()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('generateAuditReportExcel error:', error);
    res.status(500).json({ error: 'Failed to generate Excel report' });
  }
};

// Issue invoice override for selected declined/returned logs — generates an invoice PDF per practitioner
const issueInvoiceOverride = async (req, res) => {
  const { assessmentIds } = req.body;
  if (!assessmentIds || !Array.isArray(assessmentIds) || assessmentIds.length === 0) {
    return res.status(400).json({ error: 'assessmentIds array is required' });
  }
  try {
    // Fetch full assessment + practitioner data
    const { rows: assessments } = await pool.query(
      `SELECT a.*, to_jsonb(p) AS practitioners, to_jsonb(pt) AS patients
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       LEFT JOIN patients pt ON pt.id = a.patient_id
       WHERE a.id = ANY($1::int[]) AND a.billing_status = ANY($2::text[])`,
      [assessmentIds, ['declined', 'rejected']]
    );
    if (!assessments || assessments.length === 0) {
      return res.status(400).json({ error: 'No eligible assessments found' });
    }

    // Group by practitioner
    const byPractitioner = {};
    assessments.forEach(a => {
      const pId = a.practitioner_id;
      if (!byPractitioner[pId]) byPractitioner[pId] = { practitioner: a.practitioners, logs: [] };
      byPractitioner[pId].logs.push(a);
    });

    // Update DB status FIRST — so failed PDF/upload attempts leave no orphan files in storage
    await pool.query(
      "UPDATE assessments SET billing_status = 'invoiced', billing_review = 'accept', is_override = true WHERE id = ANY($1::int[]) AND billing_status = ANY($2::text[])",
      [assessmentIds, ['declined', 'rejected']]
    );

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const timeStamp = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;

    const downloadUrls = {};

    for (const { practitioner, logs } of Object.values(byPractitioner)) {
      if (!practitioner) {
        console.warn('issueInvoiceOverride: skipping batch — practitioner JOIN returned null for logs:', logs.map(l => l.id));
        continue;
      }
      const rawPayRate = practitioner.pay_rate && parseFloat(practitioner.pay_rate) > 0 ? parseFloat(practitioner.pay_rate) : 0;
      const formattedLineItems = logs.map(line => {
        const hours = line.total_time ? line.total_time / 60 : 0;
        return {
          ...line,
          date: line.service_date || '',
          total_hours: hours > 0 ? hours.toFixed(2) : '',
          child_name: `${line.patient_first_name || ''} ${line.patient_last_name || ''}`.trim(),
          child_id: line.patients?.child_id || '',
          county: line.patient_county || '',
          rate_of_pay: rawPayRate ? rawPayRate.toFixed(2) : '0.00',
          line_total: rawPayRate && hours > 0 ? (hours * rawPayRate).toFixed(2) : '0.00',
        };
      });

      const invoicePdfBuffer = await generateInvoicePDF(practitioner, formattedLineItems);

      const practName = `${practitioner.first_name}_${practitioner.last_name}`.replace(/\s+/g, '_');
      const serviceDates = logs.map(a => a.service_date).filter(Boolean).sort();
      const minDate = (serviceDates[0] || '').replace(/-/g, '');
      const maxDate = (serviceDates[serviceDates.length - 1] || '').replace(/-/g, '');
      const filePath = `${yearMonth}/${practName}/Override_Invoice_${minDate}_${maxDate}_${timeStamp}.pdf`;

      await uploadFile(BILLING_INVOICES_BUCKET, filePath, invoicePdfBuffer, 'application/pdf');
      const signedUrl = await getSignedUrl(BILLING_INVOICES_BUCKET, filePath, 3600);

      logs.forEach(a => { downloadUrls[a.id] = signedUrl; });

      // Create a billing_batches row so this override invoice can be tracked in Invoice Status
      // (printed/paid) the same way normal batches are — mirrors generateNJEISForms' insert→stamp order
      // so a failed insert/stamp here never leaves assessments pointing at a batch with no invoice.
      try {
        const { rows: batchRows } = await pool.query(
          `INSERT INTO billing_batches (practitioner_id, start_date, end_date, njeis_path, invoice_path)
           VALUES ($1, $2, $3, NULL, $4)
           RETURNING id`,
          [practitioner.id, serviceDates[0] || null, serviceDates[serviceDates.length - 1] || null, filePath]
        );
        const batchRow = batchRows[0];
        if (batchRow) {
          await pool.query(
            'UPDATE assessments SET billing_batch_id = $1 WHERE id = ANY($2::int[])',
            [batchRow.id, logs.map(l => l.id)]
          );
        }
      } catch (batchInsertError) {
        console.warn('issueInvoiceOverride: billing_batches insert/stamp failed (non-fatal):', batchInsertError.message);
      }
    }

    res.json({ success: true, updated: assessmentIds.length, downloadUrls });
  } catch (error) {
    console.error('issueInvoiceOverride error:', error);
    res.status(500).json({ error: 'Failed to issue invoice override' });
  }
};

// Export all functions
module.exports = {
  generateMasterReport,
  getPendingReports,
  getAuditLogs,
  getAllPatients,
  generateAuditNJEIS,
  generateAuditReportPDF,
  generateAuditReportExcel,
  issueInvoiceOverride
};
