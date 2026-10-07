// Independent-practitioner-only: a practitioner-owned directory of the
// early intervention agencies they bill to (name + contact email/phone/
// address/notes). Replaces free-text-only agency entry on the Log Session
// screen and powers one-tap, pre-filled "Email to Agency" on generated
// SEVFs/invoices (see billingController.js's generateSelfCertifiedSEVF/
// getSelfCertifiedHistory, which call resolveAgencyEmail below).
//
// assessments.company_affiliation (the authoritative per-session text
// field) and SEVF grouping are completely untouched by this file — an
// agency row here only changes how that string gets PICKED, never its
// storage shape downstream.
const { pool } = require('../config/db');

const listAgencies = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, address, notes, is_active, created_at, updated_at
       FROM agencies
       WHERE practitioner_id = $1 AND is_active = true
       ORDER BY lower(name)`,
      [practitionerId]
    );
    res.json({ success: true, agencies: rows });
  } catch (error) {
    console.error('Error fetching agencies:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch agencies.' });
  }
};

const createAgency = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { name, email, phone, address, notes } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, error: 'An agency name is required.' });
  }
  try {
    // Re-adding a name that matches an already-deactivated agency reactivates
    // that same row (and updates its details) instead of erroring on the
    // partial unique index — keeps the same id, so any patient_agencies rows
    // that still pointed at it (if it was deactivated rather than its
    // roster links being cleaned up some other way) resolve correctly again.
    const { rows: existingInactive } = await pool.query(
      `SELECT id FROM agencies WHERE practitioner_id = $1 AND lower(name) = lower($2) AND is_active = false`,
      [practitionerId, String(name).trim()]
    );
    if (existingInactive[0]) {
      const { rows } = await pool.query(
        `UPDATE agencies SET name = $1, email = $2, phone = $3, address = $4, notes = $5, is_active = true, updated_at = now()
         WHERE id = $6
         RETURNING id, name, email, phone, address, notes, is_active, created_at, updated_at`,
        [String(name).trim(), email?.trim() || null, phone?.trim() || null, address?.trim() || null, notes?.trim() || null, existingInactive[0].id]
      );
      return res.status(201).json({ success: true, agency: rows[0] });
    }

    const { rows } = await pool.query(
      `INSERT INTO agencies (practitioner_id, name, email, phone, address, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, address, notes, is_active, created_at, updated_at`,
      [practitionerId, String(name).trim(), email?.trim() || null, phone?.trim() || null, address?.trim() || null, notes?.trim() || null]
    );
    res.status(201).json({ success: true, agency: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'An agency with that name already exists.' });
    }
    console.error('Error creating agency:', error);
    res.status(500).json({ success: false, error: 'Failed to create agency.' });
  }
};

const updateAgency = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  const { name, email, phone, address, notes } = req.body;
  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM agencies WHERE id = $1 AND practitioner_id = $2',
      [id, practitionerId]
    );
    if (!existing[0]) return res.status(404).json({ success: false, error: 'Agency not found.' });

    const setClauses = [];
    const params = [];
    const addSet = (column, value) => { params.push(value); setClauses.push(`${column} = $${params.length}`); };
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ success: false, error: 'An agency name is required.' });
      addSet('name', String(name).trim());
    }
    if (email !== undefined) addSet('email', email?.trim() || null);
    if (phone !== undefined) addSet('phone', phone?.trim() || null);
    if (address !== undefined) addSet('address', address?.trim() || null);
    if (notes !== undefined) addSet('notes', notes?.trim() || null);
    if (setClauses.length === 0) return res.status(400).json({ success: false, error: 'Nothing to update.' });

    params.push(id);
    const { rows } = await pool.query(
      `UPDATE agencies SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${params.length}
       RETURNING id, name, email, phone, address, notes, is_active, created_at, updated_at`,
      params
    );
    res.json({ success: true, agency: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'An agency with that name already exists.' });
    }
    console.error('Error updating agency:', error);
    res.status(500).json({ success: false, error: 'Failed to update agency.' });
  }
};

// Soft delete — mirrors every other deactivate-not-destroy pattern in this
// app (dropdown options, billing batches). Also drops any patient_agencies
// rows pointing at it so a deactivated agency stops showing as a roster
// chip on a child's profile/Log Session screen.
const deleteAgency = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE agencies SET is_active = false, updated_at = now()
       WHERE id = $1 AND practitioner_id = $2
       RETURNING id`,
      [id, practitionerId]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Agency not found.' });
    await pool.query('DELETE FROM patient_agencies WHERE agency_id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting agency:', error);
    res.status(500).json({ success: false, error: 'Failed to delete agency.' });
  }
};

// GET/PUT /api/patients/:id/agencies — the roster of agencies a given child
// is currently billed to (0..N). Full-replace semantics on PUT (simplest
// correct behavior for a chip-multiselect UI — the client always sends the
// complete desired set). Ownership-scoped via patient_practitioners, same
// join updatePatient already uses in patientController.js.
const getPatientAgencies = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  try {
    const { rows: owned } = await pool.query(
      'SELECT p.id FROM patients p JOIN patient_practitioners pp ON pp.patient_id = p.id WHERE p.id = $1 AND pp.practitioner_id = $2',
      [id, practitionerId]
    );
    if (!owned[0]) return res.status(404).json({ success: false, error: 'Patient not found.' });

    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.email, a.phone
       FROM patient_agencies pa
       JOIN agencies a ON a.id = pa.agency_id AND a.is_active = true
       WHERE pa.patient_id = $1
       ORDER BY lower(a.name)`,
      [id]
    );
    res.json({ success: true, agencies: rows });
  } catch (error) {
    console.error('Error fetching patient agencies:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch this patient’s agencies.' });
  }
};

const updatePatientAgencies = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  const { agencyIds } = req.body;
  if (!Array.isArray(agencyIds)) {
    return res.status(400).json({ success: false, error: 'agencyIds must be an array.' });
  }
  try {
    const { rows: owned } = await pool.query(
      'SELECT p.id FROM patients p JOIN patient_practitioners pp ON pp.patient_id = p.id WHERE p.id = $1 AND pp.practitioner_id = $2',
      [id, practitionerId]
    );
    if (!owned[0]) return res.status(404).json({ success: false, error: 'Patient not found.' });

    // Validate every id actually belongs to this practitioner's own agency
    // list before writing anything — prevents linking someone else's (or a
    // nonexistent) agency id onto this patient.
    const cleanIds = agencyIds.map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n));
    if (cleanIds.length > 0) {
      const { rows: validRows } = await pool.query(
        'SELECT id FROM agencies WHERE id = ANY($1::int[]) AND practitioner_id = $2 AND is_active = true',
        [cleanIds, practitionerId]
      );
      if (validRows.length !== new Set(cleanIds).size) {
        return res.status(400).json({ success: false, error: 'One or more agencies could not be found.' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM patient_agencies WHERE patient_id = $1', [id]);
      for (const agencyId of new Set(cleanIds)) {
        await client.query('INSERT INTO patient_agencies (patient_id, agency_id) VALUES ($1, $2)', [id, agencyId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating patient agencies:', error);
    res.status(500).json({ success: false, error: 'Failed to update this patient’s agencies.' });
  }
};

// Case-insensitive name lookup — used by billingController.js to attach a
// saved agency's email onto a freshly generated (or historical) SEVF/
// invoice result, so "Email to Agency" can be pre-filled instead of always
// starting blank. Returns null (not an error) when no matching agency
// exists or it has no email on file — the caller falls back to today's
// manual-entry flow in that case.
async function resolveAgencyEmail(practitionerId, companyAffiliationName) {
  if (!companyAffiliationName) return null;
  const { rows } = await pool.query(
    `SELECT email FROM agencies WHERE practitioner_id = $1 AND lower(name) = lower($2) AND is_active = true LIMIT 1`,
    [practitionerId, companyAffiliationName]
  );
  return rows[0]?.email || null;
}

module.exports = {
  listAgencies,
  createAgency,
  updateAgency,
  deleteAgency,
  getPatientAgencies,
  updatePatientAgencies,
  resolveAgencyEmail,
};
