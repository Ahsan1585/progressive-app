const { pool } = require('../config/db');

// FERPA/IDEA Part C §99.30 & §303.414 enforcement — a consent is usable to
// authorize a disclosure only when it is not revoked, not expired, matches
// the recipient (case-insensitive exact match — never fuzzy, an exact
// intentional recipient is what the regulation requires), and covers every
// record type actually being disclosed (record_types @> the requested
// array, so a consent scoped to ['sevf_forms'] does NOT satisfy a request
// for ['sevf_forms', 'invoices']). No matching row at all is handled the
// same as "none of the above matched" — both read as ok:false, since the
// caller only needs to know whether it's safe to send.
async function checkConsent(patientId, recipientName, recordTypes) {
  const trimmedRecipient = String(recipientName).trim();
  const { rows } = await pool.query(
    `SELECT id FROM records_consents
     WHERE patient_id = $1
       AND lower(recipient_name) = lower($2)
       AND revoked_at IS NULL
       AND expires_at > now()
       AND record_types @> $3::text[]
     ORDER BY granted_at DESC
     LIMIT 1`,
    [patientId, trimmedRecipient, recordTypes]
  );
  if (rows[0]) return { ok: true, consentId: rows[0].id };
  return {
    ok: false,
    reason: `No consent on file for "${trimmedRecipient}" covering ${recordTypes.join(', ')} for this child — log one on the child's Consents screen before sending.`,
  };
}

module.exports = { checkConsent };
