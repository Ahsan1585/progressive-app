const { pool } = require('../config/db');
const { isValidIntId } = require('../utils/consentValidation');

// Authorization for every patient-scoped consent endpoint (records_consents
// and records_consent_requests, FERPA 34 CFR 99.30 / IDEA Part C 303.414).
// Must run after `protect` and `loadPermissions`.
//
//  - admin (req.isAdmin) or a role holding `patient_record_rights`: any
//    child (only checks the child exists, so a bad id is a clean 404).
//  - practitioner / independent_practitioner: only a child on their own
//    caseload. Same ownership rule as every other per-patient endpoint: a
//    practitioner whose link was ended by an office reassignment
//    (deactivated_reason = 'reassigned') loses access immediately
//    (303.404); a child they self-discharged stays theirs.
//  - everyone else: 403.
const FORBIDDEN = { error: 'Forbidden: insufficient permissions' };

const requireConsentAccess = async (req, res, next) => {
  try {
    const patientId = req.params.id;
    // A malformed id would otherwise be a Postgres cast error (500).
    if (!isValidIntId(patientId)) return res.status(404).json({ success: false, error: 'Patient not found.' });
    if (req.isAdmin || req.permissions?.has('patient_record_rights')) {
      const { rows } = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Patient not found.' });
      return next();
    }
    if (['practitioner', 'independent_practitioner'].includes(req.practitioner?.role)) {
      const { rows } = await pool.query(
        "SELECT 1 FROM patient_practitioners WHERE patient_id = $1 AND practitioner_id = $2 AND deactivated_reason IS DISTINCT FROM 'reassigned'",
        [patientId, req.practitioner.practitionerId]
      );
      if (!rows[0]) return res.status(403).json(FORBIDDEN);
      return next();
    }
    return res.status(403).json(FORBIDDEN);
  } catch (err) {
    return next(err);
  }
};

module.exports = { requireConsentAccess };
