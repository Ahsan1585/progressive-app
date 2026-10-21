// Office-wide "Staff Directory > All Children" tab — unlike patientController.js
// (which is scoped to req.practitioner's own attached children only), these
// endpoints see and can edit every child registered by any practitioner in
// the company. Gated by staff_directory_view/staff_directory_edit at the
// route level (patientRoutes.js), not by patient_practitioners ownership.
const { patientSchema } = require('../utils/patientSchema');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');

// One row per child, with every practitioner ever attached to them (active
// or inactive) rolled into a single array — the roster tab needs to show
// and change "the" assigned practitioner per child, not one row per
// (child, practitioner) attachment like the reporting view does.
const listDirectoryPatients = async (req, res) => {
  try {
    const { rows: patients } = await pool.query(
      `SELECT pt.id, pt.first_name, pt.middle_name, pt.last_name, pt.dob, pt.county, pt.child_id, pt.created_at,
              pt.parent_name, pt.parent_email,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'status', pp.status, 'position_title', p.position_title)
                  ORDER BY pp.status ASC, p.last_name ASC
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'
              ) AS practitioners
       FROM patients pt
       LEFT JOIN patient_practitioners pp ON pp.patient_id = pt.id
       LEFT JOIN practitioners p ON p.id = pp.practitioner_id
       GROUP BY pt.id
       ORDER BY pt.created_at DESC
       LIMIT 2000`
    );
    logAudit({ req, action: 'patient_directory_view', resourceType: 'patient', details: { count: patients.length } });
    res.json({ success: true, patients });
  } catch (error) {
    console.error('listDirectoryPatients error:', error);
    res.status(500).json({ error: 'Failed to fetch children' });
  }
};

const updateDirectoryPatient = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: existing } = await pool.query('SELECT id FROM patients WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Child not found' });

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

    logAudit({ req, action: 'patient_update', resourceType: 'patient', resourceId: id, details: { source: 'staff_directory' } });
    res.json({ message: 'Child updated successfully', data: rows[0] });
  } catch (error) {
    console.error('updateDirectoryPatient error:', error);
    if (error.errors) return res.status(400).json({ error: error.errors });
    if (error.code === '23505') return res.status(409).json({ error: 'Child ID is already in use' });
    res.status(500).json({ error: 'Failed to update child' });
  }
};

// Reassignment here means "make this the child's one active practitioner" —
// any other practitioner currently attached is set to inactive rather than
// detached, so their own historical logs/assessments for this child stay
// intact. A practitioner who legitimately needs to keep co-serving a child
// alongside the new one isn't handled here; this covers the single
// re-assignment case described by the office (child moved to a new provider).
const reassignDirectoryPatientPractitioner = async (req, res) => {
  try {
    const { id } = req.params;
    const { practitionerId } = req.body;
    if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });

    const { rows: patientRows } = await pool.query('SELECT id FROM patients WHERE id = $1', [id]);
    if (!patientRows[0]) return res.status(404).json({ error: 'Child not found' });

    const { rows: practitionerRows } = await pool.query(
      "SELECT id FROM practitioners WHERE id = $1 AND role = 'practitioner'",
      [practitionerId]
    );
    if (!practitionerRows[0]) return res.status(404).json({ error: 'Practitioner not found' });

    // deactivated_reason = 'reassigned' (not 'discharged') — this is an
    // office action moving the child to a different practitioner, so the
    // old practitioner's access must end immediately (FERPA/IDEA Part C
    // §303.404), unlike a practitioner's own self-discharge toggle which
    // intentionally keeps the record visible to them. See the
    // ownership-check queries in patientController.js.
    await pool.query(
      "UPDATE patient_practitioners SET status = $1, deactivated_reason = 'reassigned' WHERE patient_id = $2 AND practitioner_id != $3",
      ['inactive', id, practitionerId]
    );
    await pool.query(
      `INSERT INTO patient_practitioners (patient_id, practitioner_id, status, deactivated_reason)
       VALUES ($1, $2, 'active', NULL)
       ON CONFLICT (patient_id, practitioner_id) DO UPDATE SET status = 'active', deactivated_reason = NULL`,
      [id, practitionerId]
    );

    logAudit({ req, action: 'patient_reassign', resourceType: 'patient', resourceId: id, details: { practitionerId } });
    res.json({ message: 'Practitioner reassigned successfully' });
  } catch (error) {
    console.error('reassignDirectoryPatientPractitioner error:', error);
    res.status(500).json({ error: 'Failed to reassign practitioner' });
  }
};

// Adds (or reactivates) a practitioner on a child's care team WITHOUT
// touching anyone else already assigned — the counterpart to
// reassignDirectoryPatientPractitioner's deliberate "replace the whole
// team" behavior, for when a child is legitimately served by more than
// one practitioner (e.g. an OT and a PT) and the office needs to add a
// second provider rather than swap the only one.
const addDirectoryPatientPractitioner = async (req, res) => {
  try {
    const { id } = req.params;
    const { practitionerId } = req.body;
    if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });

    const { rows: patientRows } = await pool.query('SELECT id FROM patients WHERE id = $1', [id]);
    if (!patientRows[0]) return res.status(404).json({ error: 'Child not found' });

    const { rows: practitionerRows } = await pool.query(
      "SELECT id FROM practitioners WHERE id = $1 AND role = 'practitioner'",
      [practitionerId]
    );
    if (!practitionerRows[0]) return res.status(404).json({ error: 'Practitioner not found' });

    await pool.query(
      `INSERT INTO patient_practitioners (patient_id, practitioner_id, status, deactivated_reason)
       VALUES ($1, $2, 'active', NULL)
       ON CONFLICT (patient_id, practitioner_id) DO UPDATE SET status = 'active', deactivated_reason = NULL`,
      [id, practitionerId]
    );

    logAudit({ req, action: 'patient_practitioner_add', resourceType: 'patient', resourceId: id, details: { practitionerId } });
    res.json({ message: 'Practitioner added to care team successfully' });
  } catch (error) {
    console.error('addDirectoryPatientPractitioner error:', error);
    res.status(500).json({ error: 'Failed to add practitioner' });
  }
};

// Removes one practitioner from a child's active care team WITHOUT
// touching anyone else — status flips to 'inactive' (never a hard
// delete, so their own historical logs/assessments for this child stay
// intact), deactivated_reason = 'reassigned' so their access to this
// child ends immediately (FERPA/IDEA Part C §303.404 — same marker the
// office-reassignment flow and the practitioner-deactivation caseload
// clear both already use).
const removeDirectoryPatientPractitioner = async (req, res) => {
  try {
    const { id, practitionerId } = req.params;

    const { rows } = await pool.query(
      "UPDATE patient_practitioners SET status = 'inactive', deactivated_reason = 'reassigned' WHERE patient_id = $1 AND practitioner_id = $2 AND status = 'active' RETURNING patient_id",
      [id, practitionerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'This practitioner is not actively assigned to this child.' });

    logAudit({ req, action: 'patient_practitioner_remove', resourceType: 'patient', resourceId: id, details: { practitionerId } });
    res.json({ message: 'Practitioner removed from care team successfully' });
  } catch (error) {
    console.error('removeDirectoryPatientPractitioner error:', error);
    res.status(500).json({ error: 'Failed to remove practitioner' });
  }
};

module.exports = {
  listDirectoryPatients,
  updateDirectoryPatient,
  reassignDirectoryPatientPractitioner,
  addDirectoryPatientPractitioner,
  removeDirectoryPatientPractitioner,
};
