const { pool } = require('../config/db');

// A patient must belong to the requesting practitioner — same check
// /api/interventions already uses, so a draft can't be created/read/deleted
// for a child this practitioner doesn't actually serve.
async function assertOwnsPatient(patientId, practitionerId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM patient_practitioners WHERE patient_id = $1 AND practitioner_id = $2',
    [patientId, practitionerId]
  );
  return !!rows[0];
}

// POST /api/session-drafts — upsert. Body: { patientId, formData, parentSignatureBase64?, practitionerSignatureBase64? }
const saveDraft = async (req, res) => {
  const { patientId, formData, parentSignatureBase64, practitionerSignatureBase64 } = req.body;
  const practitionerId = req.practitioner.practitionerId;
  if (!patientId || !formData) {
    return res.status(400).json({ error: 'patientId and formData are required' });
  }
  try {
    if (!(await assertOwnsPatient(patientId, practitionerId))) {
      return res.status(403).json({ error: 'Not authorized for this patient' });
    }
    const { rows } = await pool.query(
      `INSERT INTO session_drafts (practitioner_id, patient_id, form_data, parent_signature, practitioner_signature)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (practitioner_id, patient_id) DO UPDATE SET
         form_data = EXCLUDED.form_data,
         parent_signature = EXCLUDED.parent_signature,
         practitioner_signature = EXCLUDED.practitioner_signature,
         updated_at = now()
       RETURNING id, updated_at`,
      [practitionerId, patientId, JSON.stringify(formData), parentSignatureBase64 || null, practitionerSignatureBase64 || null]
    );
    res.status(200).json({ success: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (error) {
    console.error('Failed to save session draft:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
};

// GET /api/session-drafts — list this practitioner's drafts (Home screen card).
// Runs the 30-day retention sweep first (same lazy-sweep pattern as the
// 90-day compliance-reference-data retention in billingController.js).
const listDrafts = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    await pool.query("DELETE FROM session_drafts WHERE updated_at < now() - interval '30 days'");
    const { rows } = await pool.query(
      `SELECT sd.patient_id, sd.updated_at, p.first_name AS patient_first_name, p.last_name AS patient_last_name
       FROM session_drafts sd
       JOIN patients p ON p.id = sd.patient_id
       WHERE sd.practitioner_id = $1
       ORDER BY sd.updated_at DESC`,
      [practitionerId]
    );
    res.json({ success: true, drafts: rows });
  } catch (error) {
    console.error('Failed to list session drafts:', error);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
};

// GET /api/session-drafts/:patientId — fetch one child's draft, to pre-fill LogIntervention.
const getDraft = async (req, res) => {
  const { patientId } = req.params;
  const practitionerId = req.practitioner.practitionerId;
  try {
    if (!(await assertOwnsPatient(patientId, practitionerId))) {
      return res.status(403).json({ error: 'Not authorized for this patient' });
    }
    const { rows } = await pool.query(
      `SELECT form_data, parent_signature, practitioner_signature, updated_at
       FROM session_drafts WHERE practitioner_id = $1 AND patient_id = $2`,
      [practitionerId, patientId]
    );
    if (!rows[0]) return res.json({ success: true, draft: null });
    res.json({
      success: true,
      draft: {
        formData: rows[0].form_data,
        parentSignatureBase64: rows[0].parent_signature,
        practitionerSignatureBase64: rows[0].practitioner_signature,
        updatedAt: rows[0].updated_at,
      },
    });
  } catch (error) {
    console.error('Failed to fetch session draft:', error);
    res.status(500).json({ error: 'Failed to fetch draft' });
  }
};

// DELETE /api/session-drafts/:patientId — explicit discard.
const deleteDraft = async (req, res) => {
  const { patientId } = req.params;
  const practitionerId = req.practitioner.practitionerId;
  try {
    if (!(await assertOwnsPatient(patientId, practitionerId))) {
      return res.status(403).json({ error: 'Not authorized for this patient' });
    }
    await pool.query('DELETE FROM session_drafts WHERE practitioner_id = $1 AND patient_id = $2', [practitionerId, patientId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete session draft:', error);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
};

module.exports = { saveDraft, listDrafts, getDraft, deleteDraft };
