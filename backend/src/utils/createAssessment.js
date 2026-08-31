const { pool } = require('../config/db');

// Thrown when a session log conflicts with one the same practitioner has
// already logged for the same child: the two sessions overlap in time on the
// same date (regardless of service type — one practitioner can't run two
// sessions for a child at once), or, for cancelled/zero-time logs, it's a
// same-date same-service repeat. Callers translate this into a 409 the
// practitioner app shows as a blocking message. Prior logs that billing has
// returned ('rejected') or permanently rejected ('declined') are ignored,
// since those are meant to be redone.
class DuplicateAssessmentError extends Error {
  constructor(message = 'A log for this session has already been submitted.') {
    super(message);
    this.name = 'DuplicateAssessmentError';
    this.code = 'DUPLICATE_LOG';
  }
}

const hhmm = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

// Finds an existing active assessment for this practitioner + child on the
// same service date that this submission conflicts with, or null. When both
// sides carry a start and end time the test is a real interval overlap
// (12:00–1:00 conflicts with 12:30–1:30); when either side is timeless
// (a cancelled "0 time" log) it falls back to a same-service repeat check.
// `excludeAssessmentId` skips the row being edited/resubmitted so a log
// never conflicts with itself.
async function findConflictingSession({ practitionerId, patientId, date, type, startTime, endTime, excludeAssessmentId = null }) {
  const start = hhmm(startTime);
  const end = hhmm(endTime);
  const hasWindow = start !== '' && end !== '';

  const { rows } = await pool.query(
    `SELECT id, type, start_time, end_time FROM assessments
      WHERE practitioner_id = $1
        AND patient_id = $2
        AND service_date = $3
        AND (billing_status IS NULL OR billing_status NOT IN ('rejected', 'declined'))
        AND ($4::int IS NULL OR id <> $4::int)
        AND (
          ( $5::bool
            AND NULLIF(start_time, '')::time < NULLIF($7, '')::time
            AND NULLIF(end_time, '')::time > NULLIF($6, '')::time )
          OR
          ( NOT ( $5::bool AND COALESCE(start_time, '') <> '' AND COALESCE(end_time, '') <> '' )
            AND type = $8 )
        )
      ORDER BY id
      LIMIT 1`,
    [practitionerId, patientId, date, excludeAssessmentId, hasWindow, start, end, type]
  );

  const conflict = rows[0] || null;
  if (conflict) {
    console.log('[session-conflict] blocked', {
      practitionerId, patientId, date, start, end, conflictId: conflict.id,
    });
  }
  return conflict;
}

// Human-facing 409 message for a detected conflict.
function conflictMessage(conflict) {
  const window = [hhmm(conflict.start_time), hhmm(conflict.end_time)].filter(Boolean).join('–');
  if (window) {
    return `This overlaps a session you already logged for this child (${window}). A practitioner can't log two sessions for the same child at the same time.`;
  }
  return 'You have already logged this session for this child.';
}

async function assertNoConflictingSession(args) {
  const conflict = await findConflictingSession(args);
  if (conflict) throw new DuplicateAssessmentError(conflictMessage(conflict));
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
  await assertNoConflictingSession({ practitionerId, patientId, date, type, startTime, endTime });

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

module.exports = {
  createAssessmentFromPayload,
  findConflictingSession,
  assertNoConflictingSession,
  conflictMessage,
  DuplicateAssessmentError,
};
