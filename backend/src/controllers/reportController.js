const { supabase } = require('../config/db');
const { generateNjeisPDF } = require('../utils/njeisGenerator');
const { generateInvoicePDF } = require('../utils/invoiceGenerator');
const { PDFDocument } = require('pdf-lib');
const puppeteer = require('puppeteer');

// 1. Logic to generate the Master Report
const generateMasterReport = async (req, res) => {
    console.log("!!! REQUEST RECEIVED IN BACKEND !!!");
    console.log("Request Body:", req.body);
  const { practitionerId, targetMonth, targetYear } = req.body;

  try {
    const { data: practitioner, error: pracError } = await supabase
      .from('practitioners')
      .select('*')
      .eq('id', practitionerId)
      .single();

    if (pracError) throw pracError;

    const parsedPractitionerId = parseInt(practitionerId, 10);
    console.log(`Searching DB for Practitioner ID: ${parsedPractitionerId} with status 'pending'`);

    const { data: pendingEncounters, error: fetchError } = await supabase
      .from('assessments')
      .select('*')
      .eq('practitioner_id', parsedPractitionerId)
      .eq('billing_status', 'pending');

    console.log("Supabase Error:", fetchError);
    console.log("Encounters Found:", pendingEncounters ? pendingEncounters.length : 0);

    if (fetchError) throw fetchError;

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

      // 🌟 NEW: Fetch the full patient record from the database to get DOB, County, and Child ID
      let patientData = null;
      if (patientId) {
        const { data: pData, error: pError } = await supabase
          .from('patients')
          .select('*')
          .eq('id', patientId)
          .single();
        
        if (!pError) patientData = pData;
        else console.warn(`Could not fetch patient details for ID ${patientId}:`, pError.message);
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
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('njeis-forms')
        .upload(fileName, pdfBuffer, { contentType: 'application/pdf' });

      if (uploadError) throw uploadError;

      // 3. Insert into master_reports with the correct patientId and calculated hours
      const { data: newReport, error: insertError } = await supabase
        .from('master_reports')
        .insert([{
          practitioner_id: practitionerId,
          patient_id: patientId, 
          child_name: childName,
          date_range: `${targetMonth}/${targetYear}`,
          total_hours: totalHours, 
          included_assessment_ids: encounterIds,
          njeis_pdf_path: uploadData.path,
          status: 'pending_approval' 
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      // 4. Lock the individual encounters using the new admin column
      await supabase
        .from('assessments')
        .update({ billing_status: 'locked_in_report' })
        .in('id', encounterIds);

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
    const { data, error } = await supabase
      .from('master_reports')
      .select('*, practitioners(first_name, last_name)') 
      .eq('status', 'pending_approval');

    // --- DIAGNOSTIC LOGS (X-RAY) ---
    console.log("FETCH ERROR:", error);
    console.log("FETCHED DATA:", data ? JSON.stringify(data, null, 2) : 'No data');
    // -------------------------------

    if (error) throw error;
    res.json({ success: true, pendingReports: data });
  } catch (error) {
    console.error('Error fetching pending reports:', error);
    res.status(500).json({ error: 'Failed to fetch pending reports.' });
  }
};

// 3. Flexible audit query — filters by practitioner name/id, patient name, date range, billing status
const getAuditLogs = async (req, res) => {
  const { practitionerSearch, patientSearch, startDate, endDate, billingStatus, compliance } = req.query;

  try {
    let practitionerIds = null;
    if (practitionerSearch && practitionerSearch.trim()) {
      const term = practitionerSearch.trim();
      const asNum = parseInt(term);
      if (!isNaN(asNum)) {
        practitionerIds = [asNum];
      } else {
        const { data: pracList } = await supabase
          .from('practitioners')
          .select('id')
          .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
        if (!pracList || pracList.length === 0) return res.json({ success: true, logs: [] });
        practitionerIds = pracList.map(p => p.id);
      }
    }

    let query = supabase
      .from('assessments')
      .select(`
        id, service_date, status, type, location, start_time, end_time, total_time,
        billing_status, billing_review, patient_first_name, patient_last_name, patient_id,
        practitioner_id, acknowledged_at,
        practitioners(first_name, last_name, position_title)
      `)
      .order('service_date', { ascending: false })
      .limit(1000);

    if (startDate) query = query.gte('service_date', startDate);
    if (endDate) query = query.lte('service_date', endDate);

    if (compliance === 'true') {
      // Compliance mode: logs > 30 days old still in pending/njeis_review
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - 30);
      const thresholdDate = threshold.toISOString().split('T')[0];
      if (!endDate) query = query.lte('service_date', thresholdDate);
      query = query.in('billing_status', ['pending', 'njeis_review']);
    } else if (billingStatus && billingStatus !== 'all') {
      query = query.eq('billing_status', billingStatus);
    }

    if (practitionerIds) query = query.in('practitioner_id', practitionerIds);
    if (patientSearch && patientSearch.trim()) {
      const term = patientSearch.trim();
      query = query.or(`patient_first_name.ilike.%${term}%,patient_last_name.ilike.%${term}%`);
    }

    const { data: logs, error } = await query;
    if (error) throw error;
    res.json({ success: true, logs: logs || [] });
  } catch (error) {
    console.error('getAuditLogs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

// 4. Generate merged NJEIS PDF from audit query — one form per (practitioner, child) pair, 10 rows per page
const generateAuditNJEIS = async (req, res) => {
  const { practitionerSearch, patientSearch, startDate, endDate, billingStatus } = req.body;

  try {
    let practitionerIds = null;
    if (practitionerSearch && practitionerSearch.trim()) {
      const term = practitionerSearch.trim();
      const asNum = parseInt(term);
      if (!isNaN(asNum)) {
        practitionerIds = [asNum];
      } else {
        const { data: pracList } = await supabase
          .from('practitioners')
          .select('id')
          .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
        if (!pracList || pracList.length === 0) return res.status(404).json({ error: 'No matching practitioners found' });
        practitionerIds = pracList.map(p => p.id);
      }
    }

    let query = supabase
      .from('assessments')
      .select(`
        id, service_date, status, type, location, start_time, end_time, total_time,
        billing_status, patient_first_name, patient_last_name, patient_id,
        practitioner_id, parent_signature, practitioner_signature,
        practitioners(first_name, last_name, position_title)
      `)
      .order('service_date', { ascending: true })
      .limit(1000);

    if (startDate) query = query.gte('service_date', startDate);
    if (endDate) query = query.lte('service_date', endDate);
    if (billingStatus && billingStatus !== 'all') query = query.eq('billing_status', billingStatus);
    if (practitionerIds) query = query.in('practitioner_id', practitionerIds);
    if (patientSearch && patientSearch.trim()) {
      const term = patientSearch.trim();
      query = query.or(`patient_first_name.ilike.%${term}%,patient_last_name.ilike.%${term}%`);
    }

    const { data: logs, error } = await query;
    if (error) throw error;
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
        const { data: pData } = await supabase.from('patients').select('*').eq('id', group.patientId).single();
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

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('njeis-forms')
      .upload(fileName, Buffer.from(mergedBytes), { contentType: 'application/pdf', upsert: false });
    if (uploadError) throw uploadError;

    const { data: { signedUrl } } = await supabase.storage
      .from('njeis-forms')
      .createSignedUrl(uploadData.path, 3600);

    res.json({ success: true, downloadUrl: signedUrl, pageCount: mergedDoc.getPageCount() });
  } catch (error) {
    console.error('generateAuditNJEIS error:', error);
    res.status(500).json({ error: 'Failed to generate audit NJEIS forms' });
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
  const filterLine = [
    filters?.startDate && `Date: ${filters.startDate} → ${filters.endDate || 'present'}`,
    filters?.practitionerSearch && `Practitioner: ${filters.practitionerSearch}`,
    filters?.patientSearch && `Patient: ${filters.patientSearch}`,
    filters?.billingStatus && filters.billingStatus !== 'all' && `Status: ${filters.billingStatus}`
  ].filter(Boolean).join('  |  ');

  const rowsHtml = logs.map(l => {
    const [y, m, d] = (l.service_date || '').split('-');
    const dateStr = y ? `${parseInt(m)}/${parseInt(d)}/${y.slice(-2)}` : '-';
    const hours = l.total_time ? `${(l.total_time / 60).toFixed(2)}h` : '-';
    return `<tr>
      <td>${l.patient_first_name || ''} ${l.patient_last_name || ''}</td>
      <td>${l.practitioners?.first_name || ''} ${l.practitioners?.last_name || ''}</td>
      <td>${dateStr}</td>
      <td>${l.type || '-'}</td>
      <td>${l.location || '-'}</td>
      <td>${l.start_time || '-'}</td>
      <td>${l.end_time || '-'}</td>
      <td>${hours}</td>
      <td class="s-${l.billing_status}">${statusLabel[l.billing_status] || l.billing_status || '-'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:sans-serif;font-size:10px;padding:20px;color:#1e293b}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e293b;padding-bottom:10px;margin-bottom:12px}
    .hdr h1{font-size:15px;font-weight:700}
    .hdr .sub{font-size:9px;color:#64748b;margin-top:3px}
    .filters{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;margin-bottom:12px;font-size:9px;color:#475569}
    .stats{display:flex;gap:12px;margin-bottom:12px}
    .stat{background:#f1f5f9;border-radius:6px;padding:6px 12px;flex:1;text-align:center}
    .stat .val{font-size:18px;font-weight:700;color:#1e293b}
    .stat .lbl{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.5px}
    table{width:100%;border-collapse:collapse;font-size:9px}
    th{background:#1e293b;color:#fff;padding:5px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
    td{padding:4px 6px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
    tr:nth-child(even) td{background:#f8fafc}
    .s-invoiced{color:#059669;font-weight:700}
    .s-pending{color:#d97706;font-weight:700}
    .s-njeis_review{color:#2563eb;font-weight:700}
    .s-declined{color:#dc2626;font-weight:700}
    .s-rejected{color:#7c3aed;font-weight:700}
    .footer{margin-top:14px;font-size:8px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:8px}
    @page{size:A4 landscape;margin:12mm}
  </style></head><body>
    <div class="hdr">
      <div><h1>Progressive Steps NJ — Audit Report</h1><div class="sub">System Audit & Reports</div></div>
      <div style="font-size:9px;color:#64748b;text-align:right">Generated: ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}<br/>${logs.length} records</div>
    </div>
    ${filterLine ? `<div class="filters"><strong>Filters applied:</strong> ${filterLine}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="val">${logs.length}</div><div class="lbl">Total Logs</div></div>
      <div class="stat"><div class="val">${totalHours}h</div><div class="lbl">Total Hours</div></div>
      <div class="stat"><div class="val">${uniqueChildren}</div><div class="lbl">Unique Patients</div></div>
      <div class="stat"><div class="val">${uniquePractitioners}</div><div class="lbl">Practitioners</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Patient Name</th><th>Practitioner</th><th>Service Date</th>
        <th>Type</th><th>Location</th><th>Start</th><th>End</th><th>Time</th><th>Status</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="footer">Progressive Steps NJ · Audit Report · Confidential</div>
  </body></html>`;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({ format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } });
  await browser.close();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="audit-report-${ts()}.pdf"`);
  res.send(pdfBuffer);
};

const ts = () => new Date().toISOString().replace(/[-:T.]/g,'').slice(0,14);

// Issue invoice override for selected declined/returned logs — generates an invoice PDF per practitioner
const issueInvoiceOverride = async (req, res) => {
  const { assessmentIds } = req.body;
  if (!assessmentIds || !Array.isArray(assessmentIds) || assessmentIds.length === 0) {
    return res.status(400).json({ error: 'assessmentIds array is required' });
  }
  try {
    // Fetch full assessment + practitioner data
    const { data: assessments, error: fetchError } = await supabase
      .from('assessments')
      .select('*, practitioners(*)')
      .in('id', assessmentIds)
      .in('billing_status', ['declined', 'rejected']);
    if (fetchError) throw fetchError;
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
    const { error } = await supabase
      .from('assessments')
      .update({ billing_status: 'invoiced', billing_review: 'accept', is_override: true })
      .in('id', assessmentIds)
      .in('billing_status', ['declined', 'rejected']);
    if (error) throw error;

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
          child_id: line.patient_id || '',
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

      await supabase.storage.from('billing-Invoices').upload(filePath, invoicePdfBuffer, { contentType: 'application/pdf', upsert: true });
      const { data: urlData } = await supabase.storage.from('billing-Invoices').createSignedUrl(filePath, 604800);
      const signedUrl = urlData?.signedUrl || null;

      logs.forEach(a => { downloadUrls[a.id] = signedUrl; });
    }

    res.json({ success: true, updated: assessmentIds.length, downloadUrls });
  } catch (error) {
    console.error('issueInvoiceOverride error:', error);
    res.status(500).json({ error: error?.message || 'Failed to issue invoice override' });
  }
};

// Export all functions
module.exports = {
  generateMasterReport,
  getPendingReports,
  getAuditLogs,
  generateAuditNJEIS,
  generateAuditReportPDF,
  issueInvoiceOverride
};