const { pool } = require('../config/db');

// A practitioner may keep at most this many concurrent in-progress drafts
// per child (e.g. catching up on two separate missed visits at once).
const MAX_DRAFTS_PER_PATIENT = 2;

// A patient must belong to the requesting practitioner — same check
// /api/interventions already uses, so a draft can't be created/listed for a
// child this practitioner doesn't actually serve.
async function assertOwnsPatient(patientId, practitionerId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM patient_practitioners WHERE patient_id = $1 AND practitioner_id = $2',
    [patientId, practitionerId]
  );
  return !!rows[0];
}

// POST /api/session-drafts — create a new draft, or update an existing one
// in place if draftId is given (resuming a draft and re-saving it must never
// spawn a second row). Body: { patientId, draftId?, formData, parentSignatureBase64?, practitionerSignatureBase64? }
const saveDraft = async (req, res) => {
  const { patientId, draftId, formData, parentSignatureBase64, practitionerSignatureBase64 } = req.body;
  const practitionerId = req.practitioner.practitionerId;
  if (!patientId || !formData) {
    return res.status(400).json({ error: 'patientId and formData are required' });
  }
  try {
    if (!(await assertOwnsPatient(patientId, practitionerId))) {
      return res.status(403).json({ error: 'Not authorized for this patient' });
    }

    if (draftId) {
      const { rows } = await pool.query(
        `UPDATE session_drafts
         SET form_data = $1, parent_signature = $2, practitioner_signature = $3, updated_at = now()
         WHERE id = $4 AND practitioner_id = $5 AND patient_id = $6
         RETURNING id, updated_at`,
        [JSON.stringify(formData), parentSignatureBase64 || null, practitionerSignatureBase64 || null, draftId, practitionerId, patientId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Draft not found' });
      return res.status(200).json({ success: true, id: rows[0].id, updatedAt: rows[0].updated_at });
    }

    // Creating a brand-new draft — enforce the per-child cap here, the one
    // place a draft count can actually grow.
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM session_drafts WHERE practitioner_id = $1 AND patient_id = $2',
      [practitionerId, patientId]
    );
    if (countRows[0].count >= MAX_DRAFTS_PER_PATIENT) {
      return res.status(409).json({
        error: `This child already has ${MAX_DRAFTS_PER_PATIENT} saved drafts. Finish or discard one before starting another.`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO session_drafts (practitioner_id, patient_id, form_data, parent_signature, practitioner_signature)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, updated_at`,
      [practitionerId, patientId, JSON.stringify(formData), parentSignatureBase64 || null, practitionerSignatureBase64 || null]
    );
    res.status(200).json({ success: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (error) {
    console.error('Failed to save session draft:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
};

// GET /api/session-drafts — every draft this practitioner has, across all
// children (Home screen's "Continue where you left off"). A child with 2
// drafts now legitimately produces 2 rows here.
const listDrafts = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    await pool.query("DELETE FROM session_drafts WHERE updated_at < now() - interval '30 days'");
    const { rows } = await pool.query(
      `SELECT sd.id, sd.patient_id, sd.updated_at, p.first_name AS patient_first_name, p.last_name AS patient_last_name
       FROM session_drafts sd
       JOIN patients p ON p.id = sd.patient_id
       WHERE sd.practitioner_id = $1
       ORDER BY sd.updated_at DESC`,
      [practitionerId]
    );
    // This list changes on nearly every screen (create/update/delete a
    // draft, submit one, hit the 2-per-child cap) — a conditional-GET 304
    // risks a client displaying a stale cached copy of it.
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, drafts: rows });
  } catch (error) {
    console.error('Failed to list session drafts:', error);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
};

// GET /api/session-drafts/patient/:patientId — this one child's drafts
// (0-2), for PatientDetail's "Resume draft" list.
const listDraftsForPatient = async (req, res) => {
  const { patientId } = req.params;
  const practitionerId = req.practitioner.practitionerId;
  try {
    if (!(await assertOwnsPatient(patientId, practitionerId))) {
      return res.status(403).json({ error: 'Not authorized for this patient' });
    }
    const { rows } = await pool.query(
      `SELECT id, updated_at FROM session_drafts WHERE practitioner_id = $1 AND patient_id = $2 ORDER BY updated_at DESC`,
      [practitionerId, patientId]
    );
    // Same reasoning as listDrafts — this is also what the "Log Session"
    // cap-check gates read fresh, so a stale 304 here could let a 3rd draft
    // slip through instead of blocking it.
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, drafts: rows });
  } catch (error) {
    console.error('Failed to list drafts for patient:', error);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
};

// GET /api/session-drafts/:draftId — fetch one specific draft's full content,
// to pre-fill LogIntervention when resuming it.
const getDraft = async (req, res) => {
  const { draftId } = req.params;
  const practitionerId = req.practitioner.practitionerId;
  try {
    const { rows } = await pool.query(
      `SELECT form_data, parent_signature, practitioner_signature, updated_at
       FROM session_drafts WHERE id = $1 AND practitioner_id = $2`,
      [draftId, practitionerId]
    );
    res.set('Cache-Control', 'no-store');
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

// DELETE /api/session-drafts/:draftId — explicit discard of one specific
// draft (or the cleanup call after that draft's encounter was submitted).
const deleteDraft = async (req, res) => {
  const { draftId } = req.params;
  const practitionerId = req.practitioner.practitionerId;
  try {
    await pool.query('DELETE FROM session_drafts WHERE id = $1 AND practitioner_id = $2', [draftId, practitionerId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete session draft:', error);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
};

module.exports = { saveDraft, listDrafts, listDraftsForPatient, getDraft, deleteDraft };
