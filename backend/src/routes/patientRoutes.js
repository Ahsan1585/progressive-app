const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { getCompanyName } = require('../utils/companyName');
const { decryptAssessmentRow } = require('../utils/fieldEncryption');

// Import the functions from the controller
const { registerPatient, getPatients, updatePatient, updatePatientStatus, getPatientAssessments, getRejectedLogs, resubmitLog, acknowledgeLog, editLog, deleteLog, voidCompletedLog, getPractitionerStats, getLastSessionDefaults, getMyLogNotes, addMyLogComment, setEimsEntered, setHiddenFromHistory } = require('../controllers/patientController');
const { listDirectoryPatients, updateDirectoryPatient, reassignDirectoryPatientPractitioner, addDirectoryPatientPractitioner, removeDirectoryPatientPractitioner } = require('../controllers/patientDirectoryController');
const { getPatientAgencies, updatePatientAgencies } = require('../controllers/agencyController');
const { listPatientConsents, createConsent, revokeConsent } = require('../controllers/recordsConsentController');
const { createConsentRequest, listConsentRequests, resendConsentRequest, cancelConsentRequest } = require('../controllers/consentRequestController');
const { requireConsentAccess } = require('../middleware/consentAccess');
const { listCorrectionRequestsForPatient, createCorrectionRequest, decideCorrectionRequest, recordStatementOfDisagreement } = require('../controllers/correctionRequestController');
const { exportPatientRecord, overrideExportPatientRecord, generateSingleChildInvoice } = require('../controllers/patientRecordExportController');
const { generateConsentReport } = require('../controllers/consentReportController');
const { createRelease, listReleases, revokeRelease } = require('../controllers/recordsReleaseController');
const { uploadConsentScan, downloadConsentScan } = require('../controllers/consentScanController');
const { protect, loadPermissions, requirePermission, requireRole } = require('../middleware/authMiddleware');

// Staff Directory > All Children — office-wide (not ownership-scoped), placed
// before the /:id wildcard routes below to avoid route conflicts.
router.get('/directory/all', protect, loadPermissions, requirePermission('staff_directory_view'), listDirectoryPatients);
router.put('/directory/:id', protect, loadPermissions, requirePermission('staff_directory_edit'), updateDirectoryPatient);
router.patch('/directory/:id/practitioner', protect, loadPermissions, requirePermission('staff_directory_edit'), reassignDirectoryPatientPractitioner);
// Care-team management — add/remove one practitioner without disturbing
// anyone else already assigned, unlike the single-swap PATCH above. The
// All Children screen uses these two for its chip-based team editor.
router.post('/directory/:id/practitioners', protect, loadPermissions, requirePermission('staff_directory_edit'), addDirectoryPatientPractitioner);
router.delete('/directory/:id/practitioners/:practitionerId', protect, loadPermissions, requirePermission('staff_directory_edit'), removeDirectoryPatientPractitioner);

// Parent-rights actions (IDEA Part C 34 CFR 303.405/.410-413) — a child's
// full early-intervention-record export and the correction-request review
// workflow. Office-wide like the directory routes above, gated by the
// dedicated patient_record_rights permission rather than
// staff_directory_view/edit, since a CEO may want to delegate this
// specifically without granting general roster-editing access.
router.get('/:id/record-export', protect, loadPermissions, requirePermission('patient_record_rights'), exportPatientRecord);
// No covering parent consent: an admin re-enters their own password and gives
// a reason (admin-only, no support sessions, per-user wrong-password lockout
// enforced in the handler).
router.post('/:id/record-export/override', protect, loadPermissions, requirePermission('patient_record_rights'), overrideExportPatientRecord);
router.get('/:id/correction-requests', protect, loadPermissions, requirePermission('patient_record_rights'), listCorrectionRequestsForPatient);
router.post('/:id/correction-requests', protect, loadPermissions, requirePermission('patient_record_rights'), createCorrectionRequest);
router.post('/correction-requests/:requestId/decide', protect, loadPermissions, requirePermission('patient_record_rights'), decideCorrectionRequest);
router.post('/correction-requests/:requestId/statement', protect, loadPermissions, requirePermission('patient_record_rights'), recordStatementOfDisagreement);
router.get('/:id/single-child-invoice', protect, loadPermissions, requirePermission('patient_record_rights'), generateSingleChildInvoice);

// Route to register a new patient
router.post('/register', protect, registerPatient);

// Route to get the list of patients for the dashboard
router.get('/', protect, getPatients);

// Route to edit a patient's details
router.put('/:id', protect, updatePatient);

// Route to toggle a patient's active/inactive status
router.patch('/:id/status', protect, updatePatientStatus);

// Rejected log routes — placed before /:id wildcard to avoid route conflict
router.get('/rejected-logs', protect, getRejectedLogs);
router.post('/resubmit-log', protect, resubmitLog);
router.post('/acknowledge-log', protect, acknowledgeLog);
router.put('/logs/:id', protect, editLog);
router.delete('/logs/:id', protect, deleteLog);
// Independent-practitioner-only — see voidCompletedLog's own comment for
// why this is a distinct action from edit/delete, gated purely by role
// like every other independent-only endpoint (no office/permission system
// exists for this role).
router.post('/logs/:id/void', protect, requireRole(['independent_practitioner']), voidCompletedLog);
// Any authenticated role may view/add notes on their own log — ownership
// is enforced inside each controller itself (practitioner_id match).
router.get('/logs/:id/notes', protect, getMyLogNotes);
router.post('/logs/:id/notes', protect, addMyLogComment);
// Independent-practitioner-only — see setEimsEntered's own comment.
router.post('/logs/:id/eims-entered', protect, requireRole(['independent_practitioner']), setEimsEntered);
// Independent-practitioner-only — see setHiddenFromHistory's own comment.
router.post('/logs/:id/hide-from-history', protect, requireRole(['independent_practitioner']), setHiddenFromHistory);

// Practitioner's own quick stats — placed before /:id wildcard to avoid route conflict
router.get('/practitioner-stats', protect, getPractitionerStats);

// Route to get a specific patient's assessments/interventions
router.get('/:id/assessments', protect, getPatientAssessments);

// Pre-fill Log Session's fields from this child's own most recent log
// (see patientController.js's getLastSessionDefaults) — any authenticated
// role, same ownership scoping as every other per-patient route.
router.get('/:id/last-session-defaults', protect, getLastSessionDefaults);

// Independent-practitioner-only — the roster of agencies a child is
// currently billed to (see agencyController.js). No office/permission
// concept exists for this role, so gated purely by role like the
// billingRoutes.js independent endpoints.
router.get('/:id/agencies', protect, requireRole(['independent_practitioner']), getPatientAgencies);
router.put('/:id/agencies', protect, requireRole(['independent_practitioner']), updatePatientAgencies);

// FERPA/IDEA Part C §99.30 & §303.414 consent records (paper consents) and
// e-sign consent requests. requireConsentAccess: admin or
// patient_record_rights for any child; a practitioner / independent
// practitioner only for a child on their own caseload (reassigned-away
// excluded); everyone else 403. The consent GATE itself (checkConsent in
// emailSevfToAgency) is unchanged and reads records_consents only.
router.get('/:id/consents', protect, loadPermissions, requireConsentAccess, listPatientConsents);
router.post('/:id/consents', protect, loadPermissions, requireConsentAccess, createConsent);
router.delete('/:id/consents/:consentId', protect, loadPermissions, requireConsentAccess, revokeConsent);
// Consent-scoped disclosure packet (only the records that consent approves,
// plus a copy of the signed consent). Gated like the full record export
// (patient_record_rights; admins pass), NOT requireConsentAccess: preparing
// a third-party disclosure is an office records-rights action.
router.get('/:id/consents/:consentId/report', protect, loadPermissions, requirePermission('patient_record_rights'), generateConsentReport);
// In-app "Send records" (agency only): emails the consent's recipient a secure
// link gated by an emailed one-time code. Same gate as the packet download.
router.post('/:id/consents/:consentId/releases', protect, loadPermissions, requirePermission('patient_record_rights'), requireConsentAccess, createRelease);
router.get('/:id/releases', protect, loadPermissions, requirePermission('patient_record_rights'), requireConsentAccess, listReleases);
router.delete('/:id/releases/:releaseId', protect, loadPermissions, requirePermission('patient_record_rights'), requireConsentAccess, revokeRelease);
// Optional scan of a signed paper consent (PDF/PNG/JPEG, 10 MB).
router.post('/:id/consents/:consentId/scan', protect, loadPermissions, requireConsentAccess, uploadConsentScan);
router.get('/:id/consents/:consentId/scan', protect, loadPermissions, requireConsentAccess, downloadConsentScan);
router.get('/:id/consent-requests', protect, loadPermissions, requireConsentAccess, listConsentRequests);
router.post('/:id/consent-requests', protect, loadPermissions, requireConsentAccess, createConsentRequest);
router.post('/:id/consent-requests/:requestId/resend', protect, loadPermissions, requireConsentAccess, resendConsentRequest);
router.delete('/:id/consent-requests/:requestId', protect, loadPermissions, requireConsentAccess, cancelConsentRequest);

// Route to generate the PDF report
router.get('/generate-pdf/:assessmentId', protect, async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const practitionerId = req.practitioner.practitionerId;

    // 1. Fetch data — scoped to the requesting practitioner (no cross-account access)
    const { rows } = await pool.query(
      'SELECT * FROM assessments WHERE id = $1 AND practitioner_id = $2',
      [assessmentId, practitionerId]
    );
    const assessment = decryptAssessmentRow(rows[0]);

    if (!assessment) return res.status(404).send('Assessment record not found');

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
    form.getTextField('Service Provider Agency Name').setText(await getCompanyName());
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
    logAudit({ req, action: 'assessment_pdf_download', resourceType: 'assessment', resourceId: assessmentId, details: { patientId: assessment.patient_id } });
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