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
                  jsonb_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'status', pp.status)
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

    await pool.query(
      'UPDATE patient_practitioners SET status = $1 WHERE patient_id = $2 AND practitioner_id != $3',
      ['inactive', id, practitionerId]
    );
    await pool.query(
      `INSERT INTO patient_practitioners (patient_id, practitioner_id, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (patient_id, practitioner_id) DO UPDATE SET status = 'active'`,
      [id, practitionerId]
    );

    logAudit({ req, action: 'patient_reassign', resourceType: 'patient', resourceId: id, details: { practitionerId } });
    res.json({ message: 'Practitioner reassigned successfully' });
  } catch (error) {
    console.error('reassignDirectoryPatientPractitioner error:', error);
    res.status(500).json({ error: 'Failed to reassign practitioner' });
  }
};

module.exports = { listDirectoryPatients, updateDirectoryPatient, reassignDirectoryPatientPractitioner };
