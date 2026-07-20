const { patientSchema } = require('../utils/patientSchema');
const { pool } = require('../config/db');

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

    // 3. Insert into Postgres
    const { rows } = await pool.query(
      `INSERT INTO patients (first_name, middle_name, last_name, dob, county, child_id, practitioner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        validatedData.firstName,
        validatedData.middleName || null,
        validatedData.lastName,
        validatedData.dob,
        validatedData.county,
        validatedData.childId,
        practitionerId,
      ]
    );

    // 4. Send success response
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

    res.status(500).json({ error: "Internal server error: " + error.message });
  }
};

const getPatients = async (req, res) => {
  try {
    // Ensure we only fetch patients for THIS practitioner
    const practitionerId = req.practitioner.practitionerId;

    const { rows: patients } = await pool.query(
      `SELECT p.*,
              (SELECT MAX(a.service_date) FROM assessments a WHERE a.patient_id = p.id) AS last_service_date
       FROM patients p
       WHERE p.practitioner_id = $1`,
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
      'SELECT id FROM patients WHERE id = $1 AND practitioner_id = $2',
      [id, practitionerId]
    );
    if (!ownedRows[0]) return res.status(404).json({ error: 'Patient not found' });

    const validatedData = patientSchema.parse(req.body);

    const { rows } = await pool.query(
      `UPDATE patients
       SET first_name = $1, middle_name = $2, last_name = $3, dob = $4, county = $5, child_id = $6
       WHERE id = $7
       RETURNING *`,
      [
        validatedData.firstName,
        validatedData.middleName || null,
        validatedData.lastName,
        validatedData.dob,
        validatedData.county,
        validatedData.childId,
        id,
      ]
    );

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

    const { rows: ownedRows } = await pool.query(
      'SELECT id FROM patients WHERE id = $1 AND practitioner_id = $2',
      [id, practitionerId]
    );
    if (!ownedRows[0]) return res.status(404).json({ error: 'Patient not found' });

    const { rows } = await pool.query(
      'UPDATE patients SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    res.json({ message: 'Patient status updated', data: rows[0] });
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
      'SELECT id FROM patients WHERE id = $1 AND practitioner_id = $2',
      [patientId, practitionerId]
    );
    if (!ownedRows[0]) return res.status(403).json({ error: 'Not authorized for this patient' });

    // Fetch this patient's assessments, additionally scoped to the practitioner
    const { rows: assessments } = await pool.query(
      'SELECT * FROM assessments WHERE patient_id = $1 AND practitioner_id = $2 ORDER BY service_date DESC',
      [patientId, practitionerId]
    );

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
              start_time, end_time, total_time, status, rejection_note, rejected_at, rejection_count,
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
  const { assessmentId, type, location, start_time, end_time, total_time, status } = req.body;
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

    await pool.query(
      `UPDATE assessments
       SET billing_status = 'pending', billing_review = NULL, type = $1, location = $2,
           start_time = $3, end_time = $4, total_time = $5, status = $6,
           rejection_note = NULL, rejected_at = NULL
       WHERE id = $7`,
      [type, location, start_time, end_time, total_time, status, assessmentId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error resubmitting log:', error);
    res.status(500).json({ error: 'Failed to resubmit log' });
  }
};

const deletePatient = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  try {
    const { rows: patientRows } = await pool.query(
      'SELECT id FROM patients WHERE id = $1 AND practitioner_id = $2',
      [id, practitionerId]
    );
    if (!patientRows[0]) return res.status(404).json({ error: 'Patient not found' });

    await pool.query('DELETE FROM patients WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting patient:', error);
    res.status(500).json({ error: 'Failed to delete patient' });
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

module.exports = { registerPatient, getPatients, updatePatient, updatePatientStatus, getPatientAssessments, getRejectedLogs, resubmitLog, acknowledgeLog, deletePatient, getPractitionerStats };
