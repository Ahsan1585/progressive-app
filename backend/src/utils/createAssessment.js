const { pool } = require('../config/db');

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

module.exports = { createAssessmentFromPayload };
