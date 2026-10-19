const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');

const VALID_RECORD_TYPES = ['session_logs', 'sevf_forms', 'invoices', 'full_record_export'];

// Same ownership-scoping pattern as every other per-patient endpoint
// (patientController.js's getPatients/updatePatient/getPatientAssessments)
// — a consent record is as sensitive as any other patient data, and
// deactivated_reason = 'reassigned' means this practitioner is no longer
// this child's assigned provider (FERPA/IDEA Part C §303.404), so their
// access to even VIEW consent records for that child must end immediately.
async function assertOwnsPatient(patientId, practitionerId) {
  const { rows } = await pool.query(
    "SELECT p.id FROM patients p JOIN patient_practitioners pp ON pp.patient_id = p.id WHERE p.id = $1 AND pp.practitioner_id = $2 AND pp.deactivated_reason IS DISTINCT FROM 'reassigned'",
    [patientId, practitionerId]
  );
  return !!rows[0];
}

const listPatientConsents = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  try {
    if (!(await assertOwnsPatient(id, practitionerId))) {
      return res.status(404).json({ success: false, error: 'Patient not found.' });
    }
    const { rows: consents } = await pool.query(
      'SELECT * FROM records_consents WHERE patient_id = $1 ORDER BY granted_at DESC',
      [id]
    );
    res.json({ success: true, consents });
  } catch (error) {
    console.error('Error listing consents:', error);
    res.status(500).json({ success: false, error: 'Failed to load consents.' });
  }
};

const createConsent = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  const { recipientName, purpose, recordTypes, expiresAt, proofNote } = req.body;

  if (!recipientName || !String(recipientName).trim()) {
    return res.status(400).json({ success: false, error: 'recipientName is required.' });
  }
  if (!purpose || !String(purpose).trim()) {
    return res.status(400).json({ success: false, error: 'purpose is required.' });
  }
  if (!Array.isArray(recordTypes) || recordTypes.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one record type is required.' });
  }
  const invalidTypes = recordTypes.filter((t) => !VALID_RECORD_TYPES.includes(t));
  if (invalidTypes.length > 0) {
    return res.status(400).json({ success: false, error: `Invalid record type(s): ${invalidTypes.join(', ')}` });
  }

  try {
    if (!(await assertOwnsPatient(id, practitionerId))) {
      return res.status(404).json({ success: false, error: 'Patient not found.' });
    }

    // Always a concrete Date computed here (not left to a DB column
    // default) so the exact expiration is known and loggable regardless
    // of what the schema's own default happens to be.
    const resolvedExpiresAt = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const { rows } = await pool.query(
      `INSERT INTO records_consents (patient_id, recipient_name, purpose, record_types, granted_by, expires_at, proof_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, String(recipientName).trim(), String(purpose).trim(), recordTypes, practitionerId, resolvedExpiresAt, proofNote || null]
    );
    const consent = rows[0];

    logAudit({
      req, action: 'records_consent_granted', resourceType: 'patient', resourceId: id,
      details: { consentId: consent.id, recipientName: consent.recipient_name, recordTypes: consent.record_types },
    });

    res.status(201).json({ success: true, consent });
  } catch (error) {
    console.error('Error creating consent:', error);
    res.status(500).json({ success: false, error: 'Failed to create consent.' });
  }
};

const revokeConsent = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id, consentId } = req.params;
  try {
    if (!(await assertOwnsPatient(id, practitionerId))) {
      return res.status(404).json({ success: false, error: 'Patient not found.' });
    }
    const { rows } = await pool.query(
      'UPDATE records_consents SET revoked_at = now(), revoked_by = $1 WHERE id = $2 AND patient_id = $3 AND revoked_at IS NULL RETURNING id',
      [practitionerId, consentId, id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Consent not found.' });

    logAudit({
      req, action: 'records_consent_revoked', resourceType: 'patient', resourceId: id,
      details: { consentId: rows[0].id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking consent:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke consent.' });
  }
};

module.exports = { listPatientConsents, createConsent, revokeConsent };
