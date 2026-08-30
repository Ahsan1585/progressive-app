const { patientSchema } = require('../utils/patientSchema');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { sanitizeCustomFields } = require('../utils/customFields');

const VALID_PATIENT_STATUSES = ['active', 'inactive'];

const registerPatient = async (req, res) => {
  try {
    console.log("Entering registerPatient..."); // Debug log

    // 1. Validate data
    const validatedData = patientSchema.parse(req.body);

    // 2. Check if middleware passed the practitioner
    if (!req.practitioner || !req.practitioner.practitionerId) {
      console.error("Auth Error: req.practitioner is missing");
      return res.status(401).json({ error: "Authentication required" });
    }

    const practitionerId = req.practitioner.practitionerId;

    // Multiple practitioners often serve the same child for different
    // services — if this Child ID is already registered (by anyone in this
    // company), attach this practitioner to that SAME shared record instead
    // of failing/duplicating it. Each practitioner's own encounter history
    // stays exactly as private as it already was (assessments.practitioner_id).
    const { rows: existingRows } = await pool.query(
      'SELECT * FROM patients WHERE child_id = $1',
      [validatedData.childId]
    );
    const existing = existingRows[0];

    if (existing) {
      const { rows: alreadyAttached } = await pool.query(
        'SELECT 1 FROM patient_practitioners WHERE patient_id = $1 AND practitioner_id = $2',
        [existing.id, practitionerId]
      );
      if (alreadyAttached[0]) {
        return res.status(409).json({ error: 'This child is already in your patient list.' });
      }

      await pool.query(
        'INSERT INTO patient_practitioners (patient_id, practitioner_id) VALUES ($1, $2)',
        [existing.id, practitionerId]
      );

      logAudit({ req, action: 'patient_attach', resourceType: 'patient', resourceId: existing.id });
      return res.status(201).json({
        message: 'This child was already registered — linked to your patient list.',
        linked: true,
        data: existing,
      });
    }

    // 3. Insert into Postgres
    const { rows } = await pool.query(
      `INSERT INTO patients (first_name, middle_name, last_name, dob, county, child_id, practitioner_id, parent_name, parent_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        validatedData.firstName,
        validatedData.middleName || null,
        validatedData.lastName,
        validatedData.dob,
        validatedData.county,
        validatedData.childId,
        practitionerId,
        validatedData.parentName || null,
        validatedData.parentEmail || null,
      ]
    );
    await pool.query(
      'INSERT INTO patient_practitioners (patient_id, practitioner_id) VALUES ($1, $2)',
      [rows[0].id, practitionerId]
    );

    // 4. Send success response
    logAudit({ req, action: 'patient_create', resourceType: 'patient', resourceId: rows[0].id });
    res.status(201).json({
      message: "Patient registered successfully",
      data: rows[0]
    });

  } catch (error) {
    console.error("Registration Error Details:", error);

    // Handle Zod validation errors
    if (error.errors) {
        return res.status(400).json({ error: error.errors });
    }
    if (error.code === '23505') return res.status(409).json({ error: 'Child ID is already in use' });

    res.status(500).json({ error: "Internal server error" });
  }
};

const getPatients = async (req, res) => {
  try {
    // Ensure we only fetch patients for THIS practitioner
    const practitionerId = req.practitioner.practitionerId;

    // pp.status (per-practitioner) is selected after p.* so it overrides
    // patients.status in the resulting row — active/inactive is this
    // practitioner's own relationship with the child, not the shared record.
    const { rows: patients } = await pool.query(
      `SELECT p.*, pp.status,
              (SELECT MAX(a.service_date) FROM assessments a WHERE a.patient_id = p.id AND a.practitioner_id = $1) AS last_service_date
       FROM patients p
       JOIN patient_practitioners pp ON pp.patient_id = p.id
       WHERE pp.practitioner_id = $1`,
      [practitionerId]
    );

    res.json(patients);
  } catch (err) {
    console.error("Fetch Patients Error:", err);
    res.status(500).json({ error: 'Server error fetching patients' });
  }
};

const updatePatient = async (req, res) => {
  try {
    const practitionerId = req.practitioner.practitionerId;
    const { id } = req.params;

    const { rows: ownedRows } = await pool.query(
      'SELECT p.id FROM patients p JOIN patient_practitioners pp ON pp.patient_id = p.id WHERE p.id = $1 AND pp.practitioner_id = $2',
      [id, practitionerId]
    );
    if (!ownedRows[0]) return res.status(404).json({ error: 'Patient not found' });

    const validatedData = patientSchema.parse(req.body);

    const { rows } = await pool.query(
      `UPDATE patients
       SET first_name = $1, middle_name = $2, last_name = $3, dob = $4, county = $5, child_id = $6, parent_name = $7, parent_email = $8
       WHERE id = $9
       RETURNING *`,
      [
        validatedData.firstName,
        validatedData.middleName || null,
        validatedData.lastName,
        validatedData.dob,
        validatedData.county,
        validatedData.childId,
        validatedData.parentName || null,
        validatedData.parentEmail || null,
        id,
      ]
    );

    logAudit({ req, action: 'patient_update', resourceType: 'patient', resourceId: id });
    res.json({ message: 'Patient updated successfully', data: rows[0] });
  } catch (error) {
    console.error('Error updating patient:', error);
    if (error.errors) return res.status(400).json({ error: error.errors });
    if (error.code === '23505') return res.status(409).json({ error: 'Child ID is already in use' });
    res.status(500).json({ error: 'Failed to update patient' });
  }
};

const updatePatientStatus = async (req, res) => {
  try {
    const practitionerId = req.practitioner.practitionerId;
    const { id } = req.params;
    const { status } = req.body;

    if (!VALID_PATIENT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${VALID_PATIENT_STATUSES.join(', ')}` });
    }

    // Status is per-practitioner (patient_practitioners), not on the shared
    // patients row — one practitioner marking a shared child inactive must
    // not affect any other practitioner's own relationship with that child.
    const { rows: updatedAttachment } = await pool.query(
      'UPDATE patient_practitioners SET status = $1 WHERE patient_id = $2 AND practitioner_id = $3 RETURNING patient_id',
      [status, id, practitionerId]
    );
    if (!updatedAttachment[0]) return res.status(404).json({ error: 'Patient not found' });

    const { rows } = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);

    logAudit({ req, action: 'patient_status_update', resourceType: 'patient', resourceId: id, details: { status } });
    res.json({ message: 'Patient status updated', data: { ...rows[0], status } });
  } catch (error) {
    console.error('Error updating patient status:', error);
    res.status(500).json({ error: 'Failed to update patient status' });
  }
};

// Fetch all assessments/interventions for a specific patient
const getPatientAssessments = async (req, res) => {
  try {
    const patientId = req.params.id;
    const practitionerId = req.practitioner.practitionerId;

    // Ownership check: the patient must belong to the requesting practitioner
    const { rows: ownedRows } = await pool.query(
      'SELECT p.id FROM patients p JOIN patient_practitioners pp ON pp.patient_id = p.id WHERE p.id = $1 AND pp.practitioner_id = $2',
      [patientId, practitionerId]
    );
    if (!ownedRows[0]) return res.status(403).json({ error: 'Not authorized for this patient' });

    // Fetch this patient's assessments, additionally scoped to the practitioner
    const { rows: assessments } = await pool.query(
      'SELECT * FROM assessments WHERE patient_id = $1 AND practitioner_id = $2 ORDER BY service_date DESC',
      [patientId, practitionerId]
    );

    logAudit({ req, action: 'patient_assessments_view', resourceType: 'patient', resourceId: patientId, details: { count: assessments.length } });
    res.status(200).json(assessments);

  } catch (error) {
    console.error("Error fetching patient assessments:", error);
    res.status(500).json({ error: "Failed to fetch interventions" });
  }
};

const getRejectedLogs = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const { rows: logs } = await pool.query(
      `SELECT id, patient_first_name, patient_last_name, patient_id, service_date, type, location,
              start_time, end_time, total_time, status, group_size_category, form_data, rejection_note, rejected_at, rejection_count,
              parent_signature, billing_status, acknowledged_at
       FROM assessments
       WHERE practitioner_id = $1
         AND billing_status = ANY($2::text[])
         AND acknowledged_at IS NULL
       ORDER BY rejected_at DESC`,
      [practitionerId, ['rejected', 'declined']]
    );
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching rejected logs:', error);
    res.status(500).json({ error: 'Failed to fetch rejected logs' });
  }
};

const acknowledgeLog = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { assessmentId, response } = req.body;
  if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

  try {
    const { rows: existingRows } = await pool.query(
      'SELECT id, billing_status FROM assessments WHERE id = $1 AND practitioner_id = $2',
      [assessmentId, practitionerId]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Log not found' });
    if (!['declined', 'rejected'].includes(existing.billing_status))
      return res.status(400).json({ error: 'Log is not in a rejected state' });

    const setClauses = ['acknowledged_at = $1'];
    const params = [new Date().toISOString()];
    if (response && response.trim()) {
      params.push(response.trim());
      setClauses.push(`practitioner_response = $${params.length}`);
      params.push(new Date().toISOString());
      setClauses.push(`responded_at = $${params.length}`);
    }
    params.push(assessmentId);

    await pool.query(
      `UPDATE assessments SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
      params
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error acknowledging log:', error);
    res.status(500).json({ error: 'Failed to acknowledge log' });
  }
};

const resubmitLog = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { assessmentId, type, location, start_time, end_time, total_time, status, note, group_size_category, custom_fields } = req.body;
  if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

  try {
    const { rows: existingRows } = await pool.query(
      'SELECT id, billing_status FROM assessments WHERE id = $1 AND practitioner_id = $2',
      [assessmentId, practitionerId]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Log not found' });
    if (existing.billing_status !== 'rejected') return res.status(400).json({ error: 'Log is not in rejected state' });

    const { rows: practitionerRows } = await pool.query(
      'SELECT service_types FROM practitioners WHERE id = $1',
      [practitionerId]
    );
    const submittingPractitioner = practitionerRows[0];
    if (submittingPractitioner.service_types?.length > 0 && !submittingPractitioner.service_types.includes(type)) {
      return res.status(403).json({ error: 'You are not registered to provide this service type' });
    }

    const sanitizedCustomFields = sanitizeCustomFields(custom_fields);

    await pool.query(
      `UPDATE assessments
       SET billing_status = 'pending', billing_review = NULL, type = $1, location = $2,
           start_time = $3, end_time = $4, total_time = $5, status = $6, group_size_category = $7,
           form_data = $8, rejection_note = NULL, rejected_at = NULL
       WHERE id = $9`,
      [type, location, start_time, end_time, total_time, status, group_size_category || null,
       JSON.stringify({ custom_fields: sanitizedCustomFields }), assessmentId]
    );

    // Optional — the practitioner's note on why/how they revised the log,
    // kept alongside the billing specialist's original return note so the
    // full back-and-forth is visible even after rejection_note is cleared.
    if (note && note.trim()) {
      await pool.query(
        `INSERT INTO assessment_notes (assessment_id, author_id, author_role, note)
         VALUES ($1, $2, $3, $4)`,
        [assessmentId, practitionerId, req.practitioner.role, note.trim()]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error resubmitting log:', error);
    res.status(500).json({ error: 'Failed to resubmit log' });
  }
};

// Practitioner-initiated edit of a log that hasn't entered the billing
// pipeline yet — mirrors deleteLog's ownership check and 'pending'-only
// gate (a 'rejected' log already has its own dedicated edit+resubmit flow,
// resubmitLog above, which also clears the rejection note and re-queues
// it for review — conflating the two here would bypass that).
const editLog = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  const { service_date, type, location, start_time, end_time, total_time, status, group_size_category, custom_fields } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT id, billing_status FROM assessments WHERE id = $1 AND practitioner_id = $2',
      [id, practitionerId]
    );
    const log = rows[0];
    if (!log) return res.status(404).json({ error: 'Log not found' });
    if (log.billing_status !== 'pending') {
      return res.status(400).json({ error: 'This log can no longer be edited.' });
    }

    const { rows: practitionerRows } = await pool.query(
      'SELECT service_types FROM practitioners WHERE id = $1',
      [practitionerId]
    );
    const submittingPractitioner = practitionerRows[0];
    if (submittingPractitioner.service_types?.length > 0 && !submittingPractitioner.service_types.includes(type)) {
      return res.status(403).json({ error: 'You are not registered to provide this service type' });
    }

    const sanitizedCustomFields = sanitizeCustomFields(custom_fields);

    await pool.query(
      `UPDATE assessments
       SET service_date = $1, type = $2, location = $3, start_time = $4, end_time = $5,
           total_time = $6, status = $7, group_size_category = $8, form_data = $9
       WHERE id = $10`,
      [service_date, type, location, start_time, end_time, total_time, status, group_size_category || null,
       JSON.stringify({ custom_fields: sanitizedCustomFields }), id]
    );
    logAudit({ req, action: 'log_edit', resourceType: 'assessment', resourceId: id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error editing log:', error);
    res.status(500).json({ error: 'Failed to edit log' });
  }
};

// Practitioner-initiated, permanent — only while a log hasn't entered the
// billing pipeline (still 'pending') or has been sent back for revision
// ('rejected'/Returned). Anything past that (njeis_review, invoiced,
// declined, on_hold) is billing's record to keep, not the practitioner's to delete.
const deleteLog = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT id, billing_status FROM assessments WHERE id = $1 AND practitioner_id = $2',
      [id, practitionerId]
    );
    const log = rows[0];
    if (!log) return res.status(404).json({ error: 'Log not found' });
    if (!['pending', 'rejected'].includes(log.billing_status)) {
      return res.status(400).json({ error: 'This log can no longer be deleted.' });
    }

    // Nothing referencing assessments(id) has ON DELETE CASCADE, so every
    // child row has to be cleared by hand or the final DELETE hits a foreign
    // key violation. Done in one transaction so a failure part-way through
    // doesn't leave the log half-deleted.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Revision-history / note thread rows.
      await client.query('DELETE FROM assessment_notes WHERE assessment_id = $1', [id]);
      // One-off compliance "allow this field" acknowledgments (NOT NULL FK).
      await client.query('DELETE FROM compliance_field_acknowledgments WHERE assessment_id = $1', [id]);
      // Telepractice logs keep their signing-request row for audit — sever
      // its link to this assessment rather than deleting that history.
      await client.query('UPDATE telepractice_signature_requests SET assessment_id = NULL WHERE assessment_id = $1', [id]);
      await client.query('DELETE FROM assessments WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
    logAudit({ req, action: 'log_delete', resourceType: 'assessment', resourceId: id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting log:', error);
    res.status(500).json({ error: 'Failed to delete log' });
  }
};

const getPractitionerStats = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const { rows: timeRows } = await pool.query(
      'SELECT total_time FROM assessments WHERE practitioner_id = $1 AND service_date >= $2',
      [practitionerId, monthStart]
    );
    const logsThisMonth = timeRows.length;
    const hoursThisMonth = timeRows.reduce((sum, r) => sum + (r.total_time || 0), 0) / 60;

    // Logs still moving through the billing pipeline (submitted or SEVF-generated, not yet invoiced/returned/declined)
    const { rows: pendingRows } = await pool.query(
      'SELECT COUNT(*) FROM assessments WHERE practitioner_id = $1 AND billing_status = ANY($2::text[])',
      [practitionerId, ['pending', 'njeis_review']]
    );
    const pendingReviewCount = parseInt(pendingRows[0].count, 10) || 0;

    res.json({ success: true, logsThisMonth, hoursThisMonth, pendingReviewCount });
  } catch (error) {
    console.error('Error fetching practitioner stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

module.exports = { registerPatient, getPatients, updatePatient, updatePatientStatus, getPatientAssessments, getRejectedLogs, resubmitLog, acknowledgeLog, editLog, deleteLog, getPractitionerStats };
