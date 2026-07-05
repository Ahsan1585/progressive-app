const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { supabase } = require('../config/db'); 

// Import the functions from the controller
const { registerPatient, getPatients, getPatientAssessments, getRejectedLogs, resubmitLog, acknowledgeLog, deletePatient, getPractitionerStats } = require('../controllers/patientController');
const { protect } = require('../middleware/authMiddleware');

// Route to register a new patient
router.post('/register', protect, registerPatient);

// Route to get the list of patients for the dashboard
router.get('/', protect, getPatients);

// Rejected log routes — placed before /:id wildcard to avoid route conflict
router.get('/rejected-logs', protect, getRejectedLogs);
router.post('/resubmit-log', protect, resubmitLog);
router.post('/acknowledge-log', protect, acknowledgeLog);

// Practitioner's own quick stats — placed before /:id wildcard to avoid route conflict
router.get('/practitioner-stats', protect, getPractitionerStats);

// Route to delete a patient (and their assessments)
router.delete('/:id', protect, deletePatient);

// Route to get a specific patient's assessments/interventions
router.get('/:id/assessments', protect, getPatientAssessments);

// Route to generate the PDF report
router.get('/generate-pdf/:assessmentId', protect, async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const practitionerId = req.practitioner.practitionerId;

    // 1. Fetch data from Supabase — scoped to the requesting practitioner (no cross-account access)
    const { data: assessment, error } = await supabase
      .from('assessments')
      .select('*')
      .eq('id', assessmentId)
      .eq('practitioner_id', practitionerId)
      .single();

    if (error || !assessment) return res.status(404).send('Assessment record not found');

    // 2. Load the template
    const pdfPath = path.join(__dirname, '../../templates/NJEIS-020.pdf');
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();

    // 3. Fill Basic Info
    form.getTextField('Childs First Name').setText(assessment.patient_first_name || '');
    form.getTextField('Childs Last Name').setText(assessment.patient_last_name || '');
    form.getTextField('Child ID').setText(String(assessment.patient_id || ''));
    
    form.getTextField('DOB').setText(assessment.patient_dob || '');
    form.getTextField('Service Provider Agency Name').setText('Progressive Steps NJ');
    form.getTextField('Practitioner First Name').setText(assessment.practitioner_first_name || '');
    form.getTextField('Practitioner Last Name').setText(assessment.practitioner_last_name || '');
    form.getTextField('DisciplinePosition Title').setText(assessment.practitioner_discipline || '');
    
    // 4. Fill Row 1 Data
    form.getTextField('Service date1').setText(assessment.service_date || '');
    form.getTextField('Service StatusRow1').setText(String(assessment.status || ''));
    form.getTextField('Service TypeRow1').setText(String(assessment.type || ''));
    form.getTextField('Service LocationRow1').setText(String(assessment.location || ''));
    form.getTextField('Start TimeRow1').setText(assessment.start_time || '');
    form.getTextField('End TimeRow1').setText(assessment.end_time || '');
    form.getTextField('Total TimeRow1').setText(String(assessment.total_time || ''));

    // 5. Embed Signatures
    const firstPage = pdfDoc.getPage(0);

    if (assessment.parent_signature) {
      const parentSigBytes = Buffer.from(assessment.parent_signature.split(',')[1], 'base64');
      const parentImage = await pdfDoc.embedPng(parentSigBytes);
      firstPage.drawImage(parentImage, { x: 420, y: 645, width: 80, height: 25 });
    }

    if (assessment.practitioner_signature) {
      const practSigBytes = Buffer.from(assessment.practitioner_signature.split(',')[1], 'base64');
      const practImage = await pdfDoc.embedPng(practSigBytes);
      firstPage.drawImage(practImage, { x: 50, y: 300, width: 120, height: 35 });
      firstPage.drawImage(practImage, { x: 250, y: 150, width: 100, height: 40 });
    }

    // 6. Return the PDF
    const pdfOutput = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Encounter-${assessmentId}.pdf`);
    res.send(Buffer.from(pdfOutput));

  } catch (error) {
    console.error("PDF Generation Error:", error);
    res.status(500).send("Failed to generate PDF");
  }
});

// IMPORTANT: A routes file must export the router!
module.exports = router;