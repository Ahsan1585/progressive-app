const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { validateIdentityVerification } = require('../utils/inspectionRequest');
const { validateConsentDetails, validateSignedOn, isValidIntId } = require('../utils/consentValidation');

const PATIENT_NOT_FOUND = { success: false, error: 'Patient not found.' };

// FERPA/IDEA Part C §99.30 & §303.414 consent records. Who may call these
// (admin / patient_record_rights for any child, a practitioner for their
// own caseload only, reassigned-away practitioners never) is enforced by
// middleware/consentAccess.js on every route before these handlers run.

const listPatientConsents = async (req, res) => {
  const { id } = req.params;
  if (!isValidIntId(id)) return res.status(404).json(PATIENT_NOT_FOUND);
  try {
    // SELECT * so the provenance columns (source, signed_on, paper_attested,
    // signed_name, signed_ip, signed_user_agent, request_id) come back too.
    // source is NULL on rows logged before e-signing existed (legacy manual).
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

// The "paper" path: the parent already signed a paper consent, and staff
// record it here. The e-sign path is consentRequestController +
// consentSigningController.
const createConsent = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  if (!isValidIntId(id)) return res.status(404).json(PATIENT_NOT_FOUND);
  const { proofNote, identityVerifiedMethod, identityVerifiedNote, signedOn, paperAttested } = req.body || {};

  // Validated before any DB work: an unparseable or past expiresAt must 400
  // with a clear reason instead of surfacing as a bare 500 from Postgres.
  const details = validateConsentDetails(req.body || {});
  if (details.error) {
    return res.status(400).json({ success: false, error: details.error });
  }

  // FERPA 34 CFR 99.30/99.31(c): the identity of whoever gave consent must be
  // authenticated, and how is recorded.
  const identityError = validateIdentityVerification(identityVerifiedMethod, identityVerifiedNote);
  if (identityError) {
    return res.status(400).json({ success: false, error: identityError });
  }

  const signedOnError = validateSignedOn(signedOn);
  if (signedOnError) {
    return res.status(400).json({ success: false, error: signedOnError });
  }
  if (paperAttested !== true) {
    return res.status(400).json({ success: false, error: 'Please confirm that a signed paper consent is on file (paperAttested must be true).' });
  }

  const { recipientName, recipientEmail, purpose, recordTypes, expiresAt } = details.value;

  // A full_record_export consent unlocks GET /record-export, so only an admin
  // may attest that such a PAPER consent is on file (req.isAdmin is set by
  // loadPermissions, which runs before requireConsentAccess on this route).
  // E-signature requests stay open to anyone with consent access: there the
  // parent's own signature is the proof.
  if (recordTypes.includes('full_record_export') && req.isAdmin !== true) {
    return res.status(403).json({ error: 'Only an admin can record a paper consent that approves a full record release.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO records_consents (patient_id, recipient_name, recipient_email, purpose, record_types, granted_by, expires_at, proof_note, identity_verified_method, identity_verified_note, source, signed_on, paper_attested)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'paper', $11, $12)
       RETURNING *`,
      [id, recipientName, recipientEmail, purpose, recordTypes, practitionerId, expiresAt, proofNote && String(proofNote).trim() ? String(proofNote).trim() : null, identityVerifiedMethod, identityVerifiedNote && String(identityVerifiedNote).trim() ? String(identityVerifiedNote).trim() : null, signedOn.trim(), true]
    );
    const consent = rows[0];

    logAudit({
      req, action: 'consent_paper_recorded', resourceType: 'patient', resourceId: id,
      details: { consentId: consent.id, recordTypeCount: (consent.record_types || recordTypes).length },
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
  if (!isValidIntId(id)) return res.status(404).json(PATIENT_NOT_FOUND);
  if (!isValidIntId(consentId)) return res.status(404).json({ success: false, error: 'Consent not found.' });
  try {
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
