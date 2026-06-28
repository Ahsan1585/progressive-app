const { supabase } = require('../config/db');
const { generateInvoicePDF } = require('../utils/invoiceGenerator');
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
    let query = supabase
      .from('assessments')
      .select('*, practitioners!inner(id, first_name, last_name, pay_rate)') 
      .in('billing_status', ['pending', 'njeis_review']); 

    if (startDate) query = query.gte('service_date', startDate);
    if (endDate) query = query.lte('service_date', endDate);

    const { data: assessments, error } = await query;
    if (error) throw error;

    const practitionerMap = {};

    assessments.forEach(record => {
      const pId = record.practitioner_id;
      if (!practitionerMap[pId]) {
        practitionerMap[pId] = {
          practitioner_id: pId,
          first_name: record.practitioners?.first_name || 'Unknown',
          last_name: record.practitioners?.last_name || 'Unknown',
          total_interventions: 0,
          unique_children: new Set(),
          total_hours: 0,
          workflow_status: 'njeis_review' 
        };
      }

      if (record.billing_status === 'pending') {
        practitionerMap[pId].workflow_status = 'pending';
      }

      practitionerMap[pId].total_interventions += 1;
      practitionerMap[pId].unique_children.add(record.patient_id);
      
      const hours = record.total_time ? (record.total_time / 60) : 0;
      practitionerMap[pId].total_hours += hours;
    });

    // 🌟 FIX: Use the new folder helper to resolve URLs
    const logs = await Promise.all(Object.values(practitionerMap).map(async log => {
      let njeis_url = null;
      if (log.workflow_status === 'njeis_review') {
        const d = new Date();
        const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const practName = `${log.first_name}_${log.last_name}`.replace(/\s+/g, '_');
        const folderPath = `${yearMonth}/${practName}`;
        const { data: folderItems } = await supabase.storage
          .from('billing-Invoices')
          .list(folderPath, { sortBy: { column: 'created_at', order: 'desc' } });
        const latestNjeis = folderItems?.find(f => f.name.startsWith('NJEIS'));
        if (latestNjeis) {
          const { data } = await supabase.storage
            .from('billing-Invoices')
            .createSignedUrl(`${folderPath}/${latestNjeis.name}`, 604800);
          njeis_url = data?.signedUrl;
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
    let query = supabase.from('assessments')
      .select('*, practitioners(*), patients(*)')
      .eq('practitioner_id', practitionerId)
      .in('billing_status', ['pending'])
      .order('service_date', { ascending: true });

    if (startDate) query = query.gte('service_date', startDate);
    if (endDate) query = query.lte('service_date', endDate);

    const { data: assessments, error: fetchError } = await query;
    if (fetchError) throw fetchError;
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
        setUniformText('Child ID', pData.patient_id?.toString()); 
        
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

    await supabase.storage.from('billing-Invoices').upload(filePath, njeisPdfBuffer, { contentType: 'application/pdf', upsert: false });

    const { data: urlData } = await supabase.storage.from('billing-Invoices').createSignedUrl(filePath, 604800);

    // Create a billing_batches record so the vault can scope this batch's logs precisely
    const { data: batchRow, error: batchInsertError } = await supabase
      .from('billing_batches')
      .insert({
        practitioner_id: practitionerId,
        start_date: serviceDates[0] || null,
        end_date: serviceDates[serviceDates.length - 1] || null,
        njeis_path: filePath,
      })
      .select('id')
      .single();

    if (batchInsertError) console.warn('billing_batches insert failed (non-fatal):', batchInsertError.message);

    // Stamp all processed assessments with this batch ID
    if (!batchInsertError && batchRow) {
      await supabase.from('assessments').update({ billing_batch_id: batchRow.id }).in('id', allAssessmentIds);
    }

    const idsToAdvance = filteredAssessments.filter(a => a.billing_status !== 'rejected').map(a => a.id);
    if (idsToAdvance.length > 0) {
      await supabase.from('assessments').update({ billing_status: 'njeis_review' }).in('id', idsToAdvance);
    }

    res.json({ success: true, downloadUrl: urlData.signedUrl, batchId: batchRow?.id || null, message: 'NJEIS Forms generated successfully!' });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

// --- 4. STEP 2: Issue Financial Invoice ---
const generateFinancialInvoice = async (req, res) => {
  const { practitionerId, startDate, endDate } = req.body;

  try {
    let query = supabase.from('assessments')
      .select('*, practitioners(*)')
      .eq('practitioner_id', practitionerId)
      .in('billing_status', ['pending', 'njeis_review'])
      .order('service_date', { ascending: true });
      
    if (startDate) query = query.gte('service_date', startDate);
    if (endDate) query = query.lte('service_date', endDate);

    const { data: assessments, error: fetchError } = await query;
    if (fetchError) throw fetchError;
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
        child_id: line.patient_id || "",               
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

    await supabase.storage.from('billing-Invoices').upload(filePath, invoicePdfBuffer, { contentType: 'application/pdf', upsert: false });

    const { data: urlData } = await supabase.storage.from('billing-Invoices').createSignedUrl(filePath, 604800);

    // Update the billing_batches record with the invoice path (batch ID comes from the assessments)
    const batchId = assessments[0]?.billing_batch_id;
    if (batchId) {
      await supabase.from('billing_batches').update({ invoice_path: filePath }).eq('id', batchId);
    }

    await supabase.from('assessments').update({ billing_status: 'invoiced' }).in('id', allAssessmentIds);

    res.json({ success: true, downloadUrl: urlData.signedUrl, message: 'Invoice issued successfully!' });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

// --- 5. Fetch actual files from your Supabase Bucket ---
const getInvoiceHistory = async (req, res) => {
  try {
    // 🌟 FIX: Since Supabase .list() only checks one folder at a time,
    // we use a recursive function to dive into the folders automatically!
    const fetchAllFiles = async (folderPath = '') => {
      const { data, error } = await supabase.storage
        .from('billing-Invoices')
        .list(folderPath, { limit: 100 });
        
      if (error) throw error;
      
      let allFiles = [];
      for (const item of data) {
        // In Supabase, if an item has NO id, it is a folder.
        if (!item.id) { 
          const subPath = folderPath ? `${folderPath}/${item.name}` : item.name;
          const subFiles = await fetchAllFiles(subPath);
          allFiles = allFiles.concat(subFiles);
        } else if (item.name.endsWith('.pdf')) {
          // If it is a PDF file, save it and attach the full folder path
          allFiles.push({ 
            ...item, 
            name: folderPath ? `${folderPath}/${item.name}` : item.name 
          });
        }
      }
      return allFiles;
    };

    const validFiles = await fetchAllFiles();
    
    // Sort files by date descending (newest first)
    validFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, invoices: validFiles });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
  }
};

// --- 6. Generate secure links for the download buttons ---
const getInvoiceDownloadUrl = async (req, res) => {
  const { fileName } = req.query;
  try {
    const { data, error } = await supabase.storage
      .from('billing-Invoices')
      .createSignedUrl(fileName, 3600); 
      
    if (error) throw error;
    res.json({ success: true, signedUrl: data.signedUrl });
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
    const updateData = { billing_status: status };
    if (status === 'pending') updateData.billing_review = 'accept';

    const { error } = await supabase
      .from('assessments')
      .update(updateData)
      .eq('id', assessmentId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating log status:', error);
    res.status(500).json({ error: 'Failed to update log status' });
  }
};

// --- 8. Reject or Return a Log ---
// type='return' → billing_status='rejected'  (practitioner must revise and resubmit)
// type='reject' → billing_status='declined'  (billing final rejection, practitioner notified, no update needed)
const rejectLog = async (req, res) => {
  const { assessmentId, note, type = 'return' } = req.body;
  if (!assessmentId || !note?.trim()) {
    return res.status(400).json({ error: 'assessmentId and a note are required' });
  }
  if (!['return', 'reject'].includes(type)) {
    return res.status(400).json({ error: 'type must be return or reject' });
  }
  try {
    const { data: current, error: fetchError } = await supabase
      .from('assessments')
      .select('rejection_count')
      .eq('id', assessmentId)
      .single();
    if (fetchError) throw fetchError;

    const newStatus = type === 'reject' ? 'declined' : 'rejected';

    const { error } = await supabase
      .from('assessments')
      .update({
        billing_status: newStatus,
        billing_review: type,
        rejection_note: note.trim(),
        rejected_at: new Date().toISOString(),
        rejection_count: (current?.rejection_count || 0) + 1
      })
      .eq('id', assessmentId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error processing log action:', error);
    res.status(500).json({ error: 'Failed to process log action' });
  }
};

// --- 9. Fetch Individual Logs for a Practitioner ---
const getPractitionerLogs = async (req, res) => {
  const { practitionerId, startDate, endDate } = req.query;
  if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });

  try {
    let query = supabase
      .from('assessments')
      .select('id, billing_status, billing_review, service_date, status, type, location, start_time, end_time, total_time, patient_first_name, patient_last_name, rejection_count')
      .eq('practitioner_id', practitionerId)
      .in('billing_status', ['pending', 'njeis_review'])
      .order('service_date', { ascending: true });

    if (startDate) query = query.gte('service_date', startDate);
    if (endDate) query = query.lte('service_date', endDate);

    const { data: logs, error } = await query;
    if (error) throw error;

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
    const parts = practitionerFolder.split('_');
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');

    const { data: practitioner, error: practError } = await supabase
      .from('practitioners')
      .select('id')
      .ilike('first_name', firstName)
      .ilike('last_name', lastName)
      .single();

    if (practError || !practitioner) {
      return res.status(404).json({ error: 'Practitioner not found' });
    }

    let query = supabase
      .from('assessments')
      .select('id, billing_status, billing_review, service_date, status, type, location, start_time, end_time, total_time, patient_first_name, patient_last_name')
      .eq('practitioner_id', practitioner.id)
      .in('billing_status', ['invoiced', 'declined', 'rejected']);

    if (batchId) {
      // New batch: exact scoping by batch ID — no date range needed
      query = query.eq('billing_batch_id', batchId);
    } else if (isOverride === 'true') {
      // Override row: logs explicitly marked as override-invoiced
      query = query
        .gte('service_date', startDate)
        .lte('service_date', endDate)
        .eq('is_override', true);
    } else {
      // Old-batch fallback: date range scoped to logs with no batch ID
      // Prevents new-batch logs (billing_batch_id IS NOT NULL) from bleeding into old-batch expands
      query = query
        .gte('service_date', startDate)
        .lte('service_date', endDate)
        .is('billing_batch_id', null)
        .eq('is_override', false);
    }

    const { data: logs, error } = await query.order('service_date', { ascending: true });

    if (error) throw error;
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching vault logs:', error);
    res.status(500).json({ error: 'Failed to fetch vault logs' });
  }
};

// --- 11. Return all billing_batches records (for vault batchId lookup) ---
const getBillingBatches = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('billing_batches')
      .select('id, njeis_path, invoice_path, start_date, end_date, practitioner_id')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, batches: data || [] });
  } catch (error) {
    console.error('getBillingBatches error:', error);
    res.status(500).json({ error: 'Failed to fetch billing batches' });
  }
};

// --- 12. One-time retroactive backfill: stamp billing_batch_id on old assessments ---
// Creates billing_batches records for all NJEIS files that don't have one,
// then assigns assessments to batches processing newest-first so each log
// goes to its most-recent batch.
const backfillBillingBatches = async (req, res) => {
  try {
    // Reuse recursive file lister
    const fetchAllFiles = async (folderPath = '') => {
      const { data, error } = await supabase.storage
        .from('billing-Invoices')
        .list(folderPath, { limit: 100 });
      if (error) throw error;
      let files = [];
      for (const item of data) {
        if (!item.id) {
          const sub = await fetchAllFiles(folderPath ? `${folderPath}/${item.name}` : item.name);
          files = files.concat(sub);
        } else if (item.name.endsWith('.pdf')) {
          files.push({ ...item, name: folderPath ? `${folderPath}/${item.name}` : item.name });
        }
      }
      return files;
    };

    const allFiles = await fetchAllFiles();
    const njeisFiles = allFiles.filter(f => /\/NJEIS_\d{8}_\d{8}_\d{6}\.pdf$/.test(f.name));
    const invoiceFiles = allFiles.filter(f => /\/Invoice_\d{8}_\d{8}_\d{6}\.pdf$/.test(f.name));
    const overrideFiles = allFiles.filter(f => /\/Override_Invoice_/.test(f.name));

    // Mark assessments linked to override invoices so they're never assigned to regular batches
    for (const ovFile of overrideFiles) {
      const parts = ovFile.name.split('/');
      if (parts.length < 3) continue;
      const practFolder = parts[1];
      const nameParts = practFolder.split('_');
      const firstName = nameParts[0];
      const lastName  = nameParts.slice(1).join(' ');
      const { data: prac } = await supabase.from('practitioners')
        .select('id').ilike('first_name', firstName).ilike('last_name', lastName).single();
      if (!prac) continue;
      // Mark invoiced logs with no batch ID for this practitioner as override
      await supabase.from('assessments')
        .update({ is_override: true })
        .eq('practitioner_id', prac.id)
        .eq('billing_status', 'invoiced')
        .eq('is_override', false)
        .is('billing_batch_id', null);
    }

    // Load existing batches
    const { data: existingBatches, error: bFetchErr } = await supabase
      .from('billing_batches')
      .select('id, practitioner_id, start_date, end_date, njeis_path');
    if (bFetchErr) throw bFetchErr;

    const existingByPath = {};
    (existingBatches || []).forEach(b => { if (b.njeis_path) existingByPath[b.njeis_path] = b; });

    let created = 0;
    const allBatches = [...(existingBatches || [])];

    // Create missing billing_batches records
    for (const njeisFile of njeisFiles) {
      if (existingByPath[njeisFile.name]) continue;

      const parts = njeisFile.name.split('/');
      if (parts.length < 3) continue;
      const practFolder = parts[1];
      const fileName = parts[parts.length - 1];
      const m = fileName.match(/^NJEIS_(\d{8})_(\d{8})_(\d{6})\.pdf$/);
      if (!m) continue;
      const [, minDate, maxDate] = m;

      const startDate = `${minDate.slice(0,4)}-${minDate.slice(4,6)}-${minDate.slice(6,8)}`;
      const endDate   = `${maxDate.slice(0,4)}-${maxDate.slice(4,6)}-${maxDate.slice(6,8)}`;

      const nameParts = practFolder.split('_');
      const firstName = nameParts[0];
      const lastName  = nameParts.slice(1).join(' ');
      const { data: prac } = await supabase.from('practitioners')
        .select('id').ilike('first_name', firstName).ilike('last_name', lastName).single();
      if (!prac) continue;

      // Find matching invoice file (same folder + same date range)
      const folderPrefix = parts.slice(0, -1).join('/');
      const matchInvoice = invoiceFiles.find(f =>
        f.name.startsWith(`${folderPrefix}/Invoice_${minDate}_${maxDate}_`)
      );

      const { data: newBatch } = await supabase.from('billing_batches').insert({
        practitioner_id: prac.id,
        start_date: startDate,
        end_date: endDate,
        njeis_path: njeisFile.name,
        invoice_path: matchInvoice?.name || null
      }).select('id, practitioner_id, start_date, end_date, njeis_path').single();

      if (newBatch) {
        allBatches.push(newBatch);
        created++;
      }
    }

    // Group by practitioner and assign assessments newest-batch-first
    const byPrac = {};
    for (const b of allBatches) {
      if (!b.practitioner_id || !b.id) continue;
      if (!byPrac[b.practitioner_id]) byPrac[b.practitioner_id] = [];
      byPrac[b.practitioner_id].push(b);
    }

    let assigned = 0;
    for (const [pracId, batches] of Object.entries(byPrac)) {
      // Newest-first: latest end_date first, then latest filename timestamp first
      batches.sort((a, b) => {
        const endCmp = (b.end_date || '').localeCompare(a.end_date || '');
        if (endCmp !== 0) return endCmp;
        const tsA = (a.njeis_path || '').match(/_(\d{6})\.pdf$/)?.[1] || '000000';
        const tsB = (b.njeis_path || '').match(/_(\d{6})\.pdf$/)?.[1] || '000000';
        return tsB.localeCompare(tsA);
      });

      for (const batch of batches) {
        const { data: assessments } = await supabase.from('assessments')
          .select('id')
          .eq('practitioner_id', parseInt(pracId))
          .in('billing_status', ['invoiced', 'declined', 'rejected'])
          .is('billing_batch_id', null)
          .eq('is_override', false)
          .gte('service_date', batch.start_date)
          .lte('service_date', batch.end_date);

        if (assessments?.length) {
          await supabase.from('assessments')
            .update({ billing_batch_id: batch.id })
            .in('id', assessments.map(a => a.id));
          assigned += assessments.length;
        }
      }
    }

    res.json({ success: true, created, assigned, message: `Backfill complete: ${created} batches created, ${assigned} assessments linked` });
  } catch (error) {
    console.error('backfillBillingBatches error:', error);
    res.status(500).json({ error: error.message || 'Backfill failed' });
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
  backfillBillingBatches
};