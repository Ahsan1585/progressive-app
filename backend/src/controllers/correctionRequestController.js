// Office-wide "correction request" workflow — a formal record of a parent/
// guardian asking to amend a child's early intervention record, separate
// from a practitioner silently editing a session log. Gated by the
// patient_record_rights permission at the route level, not by
// patient_practitioners ownership (same office-wide pattern as
// patientDirectoryController.js), since this is a CEO/admin-delegated
// parent-rights action, not a practitioner's own-caseload tool.
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');

// All requests for one child, newest first — the "Corrections" panel for a
// single patient.
const listCorrectionRequestsForPatient = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: patientRows } = await pool.query('SELECT id FROM patients WHERE id = $1', [id]);
    if (!patientRows[0]) return res.status(404).json({ error: 'Child not found' });

    const { rows } = await pool.query(
      `SELECT cr.*,
              requester.first_name AS requested_by_first_name, requester.last_name AS requested_by_last_name,
              reviewer.first_name AS reviewed_by_first_name, reviewer.last_name AS reviewed_by_last_name
       FROM correction_requests cr
       LEFT JOIN practitioners requester ON requester.id = cr.requested_by
       LEFT JOIN practitioners reviewer ON reviewer.id = cr.reviewed_by
       WHERE cr.patient_id = $1
       ORDER BY cr.requested_at DESC`,
      [id]
    );
    res.json({ success: true, requests: rows });
  } catch (error) {
    console.error('listCorrectionRequestsForPatient error:', error);
    res.status(500).json({ error: 'Failed to fetch correction requests' });
  }
};

// Logs that a parent/guardian asked for a correction. There's no
// unauthenticated parent-facing form for this (consistent with every other
// parent-rights flow in this app being agency-mediated) — staff record the
// request on the parent's behalf after a call, email, or in-person ask.
const createCorrectionRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { assessmentId, requestNote } = req.body;

    if (!requestNote?.trim()) {
      return res.status(400).json({ error: 'requestNote is required — describe what the parent/guardian asked to have corrected.' });
    }

    const { rows: patientRows } = await pool.query('SELECT id FROM patients WHERE id = $1', [id]);
    if (!patientRows[0]) return res.status(404).json({ error: 'Child not found' });

    if (assessmentId) {
      const { rows: assessmentRows } = await pool.query(
        'SELECT id FROM assessments WHERE id = $1 AND patient_id = $2',
        [assessmentId, id]
      );
      if (!assessmentRows[0]) return res.status(400).json({ error: 'That session log does not belong to this child.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO correction_requests (patient_id, assessment_id, requested_by, request_note)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, assessmentId || null, req.practitioner.practitionerId, requestNote.trim()]
    );

    logAudit({ req, action: 'correction_request_create', resourceType: 'patient', resourceId: id, details: { correctionRequestId: rows[0].id, assessmentId: assessmentId || null } });
    res.status(201).json({ success: true, request: rows[0] });
  } catch (error) {
    console.error('createCorrectionRequest error:', error);
    res.status(500).json({ error: 'Failed to create correction request' });
  }
};

// Accept/deny-with-note, same shape as billingController.decideMissingInEims
// — a comment is required on denial (the parent needs a reason), optional
// on acceptance.
const decideCorrectionRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, decisionNote } = req.body;

    if (!['accepted', 'denied'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "accepted" or "denied"' });
    }
    if (decision === 'denied' && !decisionNote?.trim()) {
      return res.status(400).json({ error: 'A decisionNote is required to deny a correction request.' });
    }

    const { rows: existing } = await pool.query(
      'SELECT id, status FROM correction_requests WHERE id = $1',
      [requestId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Correction request not found' });
    if (existing[0].status !== 'pending') {
      return res.status(400).json({ error: 'This correction request has already been decided.' });
    }

    const { rows } = await pool.query(
      `UPDATE correction_requests
       SET status = $1, reviewed_by = $2, reviewed_at = now(), decision_note = $3, updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [decision, req.practitioner.practitionerId, decisionNote?.trim() || null, requestId]
    );

    logAudit({ req, action: `correction_request_${decision}`, resourceType: 'patient', resourceId: rows[0].patient_id, details: { correctionRequestId: rows[0].id, decisionNote: decisionNote?.trim() || null } });
    res.json({ success: true, request: rows[0] });
  } catch (error) {
    console.error('decideCorrectionRequest error:', error);
    res.status(500).json({ error: 'Failed to record decision' });
  }
};

module.exports = { listCorrectionRequestsForPatient, createCorrectionRequest, decideCorrectionRequest };
