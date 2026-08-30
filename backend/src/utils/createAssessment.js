const { pool } = require('../config/db');

// Thrown when a session log that duplicates an existing one is submitted —
// same practitioner, child, service date, service type, and start/end time.
// Callers translate this into a 409 the practitioner app shows as a blocking
// dialog. Prior logs that billing has returned ('rejected') or permanently
// rejected ('declined') are ignored, since those are meant to be redone.
class DuplicateAssessmentError extends Error {
  constructor(message = 'A log for this session has already been submitted.') {
    super(message);
    this.name = 'DuplicateAssessmentError';
    this.code = 'DUPLICATE_LOG';
  }
}

// Returns true when an active (non-rejected) assessments row already exists
// for this exact practitioner + child + date + service type + start/end time.
async function assessmentDuplicateExists({ practitionerId, patientId, date, type, startTime, endTime }) {
  const { rows } = await pool.query(
    `SELECT 1 FROM assessments
      WHERE practitioner_id = $1
        AND patient_id = $2
        AND service_date = $3
        AND type = $4
        AND COALESCE(start_time, '') = COALESCE($5, '')
        AND COALESCE(end_time, '') = COALESCE($6, '')
        AND (billing_status IS NULL OR billing_status NOT IN ('rejected', 'declined'))
      LIMIT 1`,
    [practitionerId, patientId, date, type, startTime, endTime]
  );
  return !!rows[0];
}

// The single INSERT that creates a real, billing-visible session log — used
// by both POST /api/interventions (backend/index.js, the normal in-person
// submit path) and the telepractice Confirm & Submit endpoint
// (telepracticeSignatureController.js). Extracted so there is exactly one
// place that writes an assessments row from a full session payload, instead
// of two hand-duplicated INSERTs that can drift out of sync.
//
// `sanitizedCustomFields` must already have been run through
// sanitizeCustomFields() by the caller — this function does no validation
// of its own, matching the original inline handler's behavior.
async function createAssessmentFromPayload({
  patientId, practitionerId,
  patient_first_name, patient_last_name, patient_dob, patient_county,
  practitioner_first_name, practitioner_last_name, practitioner_discipline,
  date, startTime, endTime, totalTime,
  status, type, location, groupSizeCategory,
  parentSignatureBase64, practitionerSignatureBase64,
  sanitizedCustomFields,
  note, authorId, authorRole,
}) {
  if (await assessmentDuplicateExists({ practitionerId, patientId, date, type, startTime, endTime })) {
    throw new DuplicateAssessmentError();
  }

  const { rows: insertedRows } = await pool.query(
    `INSERT INTO assessments
       (patient_id, practitioner_id, patient_first_name, patient_last_name, patient_dob, patient_county,
        practitioner_first_name, practitioner_last_name, practitioner_discipline,
        service_date, start_time, end_time, total_time, status, type, location, group_size_category,
        parent_signature, practitioner_signature, form_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING *`,
    [
      patientId, practitionerId, patient_first_name, patient_last_name, patient_dob, patient_county,
      practitioner_first_name, practitioner_last_name, practitioner_discipline,
      date, startTime, endTime, totalTime, status, type, location, groupSizeCategory || null,
      parentSignatureBase64, practitionerSignatureBase64,
      JSON.stringify({ custom_fields: sanitizedCustomFields || {} }),
    ]
  );

  const assessment = insertedRows[0];

  // Optional — surfaces in the same comment thread billing/admins already
  // see in Session Detail (getLogNotes), rather than a new separate field.
  if (note && note.trim()) {
    await pool.query(
      `INSERT INTO assessment_notes (assessment_id, author_id, author_role, note)
       VALUES ($1, $2, $3, $4)`,
      [assessment.id, authorId, authorRole, note.trim()]
    );
  }

  // A real, submitted log supersedes any in-progress draft for this same
  // child — clear it now rather than leaving a stale draft the
  // practitioner would otherwise have to notice and delete themselves.
  await pool.query(
    'DELETE FROM session_drafts WHERE practitioner_id = $1 AND patient_id = $2',
    [practitionerId, patientId]
  );

  return assessment;
}

module.exports = { createAssessmentFromPayload, assessmentDuplicateExists, DuplicateAssessmentError };
