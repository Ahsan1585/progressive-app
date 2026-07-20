const { pool } = require('../config/db');
const { buildSessionICS } = require('../utils/icsGenerator');
const { sendSessionScheduledEmail } = require('../utils/emailClient');

const notifyParent = async (session, patient, practitioner, { cancelled = false } = {}) => {
  if (!patient.parent_email) return;

  const childName = `${patient.first_name} ${patient.last_name}`;
  const practitionerName = `${practitioner.first_name} ${practitioner.last_name}`;
  const icsContent = buildSessionICS({
    sessionId: session.id,
    sessionDate: session.session_date,
    startTime: session.start_time,
    endTime: session.end_time,
    summary: `${childName}'s session with ${practitionerName}`,
    location: session.location,
    description: session.notes,
    cancelled,
  });

  try {
    await sendSessionScheduledEmail(patient.parent_email, {
      childName,
      practitionerName,
      sessionDate: session.session_date,
      startTime: session.start_time,
      endTime: session.end_time,
      location: session.location,
      icsContent,
      cancelled,
    });
    await pool.query('UPDATE scheduled_sessions SET parent_notified_at = now() WHERE id = $1', [session.id]);
  } catch (err) {
    // Session is already saved — a failed notification shouldn't roll that back.
    console.error('Failed to send session schedule email:', err);
  }
};

const loadOwnedPatientAndPractitioner = async (patientId, practitionerId) => {
  const patientResult = await pool.query('SELECT * FROM patients WHERE id = $1 AND practitioner_id = $2', [patientId, practitionerId]);
  if (patientResult.rows.length === 0) return null;
  const practitionerResult = await pool.query('SELECT first_name, last_name FROM practitioners WHERE id = $1', [practitionerId]);
  return { patient: patientResult.rows[0], practitioner: practitionerResult.rows[0] };
};

const createSession = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { patientId, sessionDate, startTime, endTime, location, notes } = req.body;

  if (!patientId || !sessionDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'patientId, sessionDate, startTime, and endTime are required.' });
  }

  try {
    const owned = await loadOwnedPatientAndPractitioner(patientId, practitionerId);
    if (!owned) return res.status(403).json({ error: 'Not authorized for this patient.' });

    const result = await pool.query(
      `INSERT INTO scheduled_sessions (patient_id, practitioner_id, session_date, start_time, end_time, location, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [patientId, practitionerId, sessionDate, startTime, endTime, location || null, notes || null]
    );
    const session = result.rows[0];

    await notifyParent(session, owned.patient, owned.practitioner);
    res.status(201).json(session);
  } catch (err) {
    console.error('createSession error:', err);
    res.status(500).json({ error: 'Failed to schedule session.' });
  }
};

const updateSession = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  const { sessionDate, startTime, endTime, location, notes } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM scheduled_sessions WHERE id = $1 AND practitioner_id = $2', [id, practitionerId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Scheduled session not found.' });
    if (existing.rows[0].status === 'cancelled') return res.status(400).json({ error: 'Cannot reschedule a cancelled session.' });

    const result = await pool.query(
      `UPDATE scheduled_sessions
       SET session_date = COALESCE($1, session_date),
           start_time   = COALESCE($2, start_time),
           end_time     = COALESCE($3, end_time),
           location     = COALESCE($4, location),
           notes        = COALESCE($5, notes)
       WHERE id = $6 RETURNING *`,
      [sessionDate || null, startTime || null, endTime || null, location ?? null, notes ?? null, id]
    );
    const session = result.rows[0];

    const owned = await loadOwnedPatientAndPractitioner(session.patient_id, practitionerId);
    await notifyParent(session, owned.patient, owned.practitioner);
    res.json(session);
  } catch (err) {
    console.error('updateSession error:', err);
    res.status(500).json({ error: 'Failed to reschedule session.' });
  }
};

const cancelSession = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE scheduled_sessions SET status = 'cancelled' WHERE id = $1 AND practitioner_id = $2 RETURNING *`,
      [id, practitionerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Scheduled session not found.' });
    const session = result.rows[0];

    const owned = await loadOwnedPatientAndPractitioner(session.patient_id, practitionerId);
    await notifyParent(session, owned.patient, owned.practitioner, { cancelled: true });
    res.json(session);
  } catch (err) {
    console.error('cancelSession error:', err);
    res.status(500).json({ error: 'Failed to cancel session.' });
  }
};

const listSessions = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { patientId, from, to } = req.query;

  try {
    const params = [practitionerId];
    let sql = `
      SELECT s.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name
      FROM scheduled_sessions s
      JOIN patients p ON p.id = s.patient_id
      WHERE s.practitioner_id = $1
    `;
    if (patientId) { params.push(patientId); sql += ` AND s.patient_id = $${params.length}`; }
    if (from) { params.push(from); sql += ` AND s.session_date >= $${params.length}`; }
    if (to) { params.push(to); sql += ` AND s.session_date <= $${params.length}`; }
    sql += ' ORDER BY s.session_date ASC, s.start_time ASC';

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('listSessions error:', err);
    res.status(500).json({ error: 'Failed to load scheduled sessions.' });
  }
};

module.exports = { createSession, updateSession, cancelSession, listSessions };
