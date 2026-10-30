const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { computeDueDate, daysRemaining, isOverdue, validateIdentityVerification } = require('../utils/inspectionRequest');
const { decryptField } = require('../utils/fieldEncryption');

// IDEA Part C 34 CFR 303.405: tracks parent requests to inspect a child's
// records against the 10-day response deadline. Access is gated by the
// patient_record_rights permission at the route level.

const STATUSES = ['open', 'fulfilled', 'denied'];
// due_at/requested_at are DATE columns; cast to text so they stay plain
// YYYY-MM-DD strings (no timezone shifting through JS Dates).
const COLS = `id, patient_id, requested_by_name, requested_by_relationship, requested_at::text AS requested_at,
  received_by, identity_verified_method, identity_verified_note, due_at::text AS due_at, status,
  fulfilled_at, fulfilled_by, fulfillment_note, created_at`;

const decorate = (row, now = new Date()) => ({
  ...row,
  daysRemaining: row.status === 'open' ? daysRemaining(row.due_at, now) : null,
  overdue: isOverdue(row, now),
});

const createInspectionRequest = async (req, res) => {
  const { patientId, requestedByName, requestedByRelationship, requestedAt, identityVerifiedMethod, identityVerifiedNote } = req.body || {};
  if (!patientId) return res.status(400).json({ success: false, error: 'patientId is required.' });
  if (!requestedByName || !String(requestedByName).trim()) {
    return res.status(400).json({ success: false, error: 'requestedByName is required.' });
  }
  const dueAt = computeDueDate(requestedAt);
  if (!dueAt) return res.status(400).json({ success: false, error: 'requestedAt must be a valid date (YYYY-MM-DD).' });
  const identityError = validateIdentityVerification(identityVerifiedMethod, identityVerifiedNote);
  if (identityError) return res.status(400).json({ success: false, error: identityError });

  try {
    const patient = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
    if (!patient.rows[0]) return res.status(404).json({ success: false, error: 'Patient not found.' });

    const { rows } = await pool.query(
      `INSERT INTO records_inspection_requests
         (patient_id, requested_by_name, requested_by_relationship, requested_at, received_by,
          identity_verified_method, identity_verified_note, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${COLS}`,
      [
        patientId, String(requestedByName).trim(),
        requestedByRelationship ? String(requestedByRelationship).trim() : null,
        requestedAt, req.practitioner.practitionerId, identityVerifiedMethod,
        identityVerifiedNote && String(identityVerifiedNote).trim() ? String(identityVerifiedNote).trim() : null,
        dueAt,
      ]
    );
    const request = rows[0];
    logAudit({
      req, action: 'records_inspection_requested', resourceType: 'patient', resourceId: patientId,
      details: { requestId: request.id, requestedByName: request.requested_by_name, dueAt },
    });
    res.status(201).json({ success: true, request: decorate(request) });
  } catch (error) {
    console.error('Error creating inspection request:', error);
    res.status(500).json({ success: false, error: 'Failed to create inspection request.' });
  }
};

const listInspectionRequests = async (req, res) => {
  const { status } = req.query || {};
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: `status must be one of: ${STATUSES.join(', ')}.` });
  }
  try {
    const params = status ? [status] : [];
    const { rows } = await pool.query(
      `SELECT r.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name FROM (
         SELECT ${COLS} FROM records_inspection_requests ${status ? 'WHERE status = $1' : ''}
       ) r JOIN patients p ON p.id = r.patient_id ORDER BY r.due_at ASC, r.id ASC`,
      params
    );
    res.json({
      success: true,
      requests: rows.map((r) => decorate({
        ...r,
        patient_first_name: decryptField(r.patient_first_name),
        patient_last_name: decryptField(r.patient_last_name),
      })),
    });
  } catch (error) {
    console.error('Error listing inspection requests:', error);
    res.status(500).json({ success: false, error: 'Failed to load inspection requests.' });
  }
};

const listForPatient = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM records_inspection_requests WHERE patient_id = $1 ORDER BY requested_at DESC, id DESC`,
      [req.params.patientId]
    );
    res.json({ success: true, requests: rows.map((r) => decorate(r)) });
  } catch (error) {
    console.error('Error listing patient inspection requests:', error);
    res.status(500).json({ success: false, error: 'Failed to load inspection requests.' });
  }
};

const fulfillInspectionRequest = async (req, res) => {
  const note = req.body && req.body.fulfillmentNote;
  if (!note || !String(note).trim()) {
    return res.status(400).json({ success: false, error: 'fulfillmentNote is required.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE records_inspection_requests
          SET status = 'fulfilled', fulfilled_at = now(), fulfilled_by = $1, fulfillment_note = $2
        WHERE id = $3 AND status = 'open'
        RETURNING ${COLS}`,
      [req.practitioner.practitionerId, String(note).trim(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Open request not found.' });
    logAudit({
      req, action: 'records_inspection_fulfilled', resourceType: 'patient', resourceId: rows[0].patient_id,
      details: { requestId: rows[0].id, dueAt: rows[0].due_at },
    });
    res.json({ success: true, request: decorate(rows[0]) });
  } catch (error) {
    console.error('Error fulfilling inspection request:', error);
    res.status(500).json({ success: false, error: 'Failed to fulfill inspection request.' });
  }
};

module.exports = { createInspectionRequest, listInspectionRequests, listForPatient, fulfillInspectionRequest };
