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
//
// recipientEmail (optional, 4th param): when a disclosure is email-based
// (e.g. emailSevfToAgency), the consent must ALSO match the actual
// destination address, not just the free-text recipient name — a consent
// for "ABC Billing" must not authorize a send to an unrelated or mistyped
// address just because the practitioner's company_affiliation field
// happens to say "ABC Billing" too. Those are two independently-entered
// fields with no enforced relationship otherwise. Omit it for a
// non-email disclosure point, where there's no address to check.
async function checkConsent(patientId, recipientName, recordTypes, recipientEmail) {
  const trimmedRecipient = String(recipientName).trim();
  const params = [patientId, trimmedRecipient, recordTypes];
  let emailClause = '';
  if (recipientEmail) {
    params.push(String(recipientEmail).trim());
    emailClause = `AND lower(recipient_email) = lower($${params.length})\n       `;
  }
  const { rows } = await pool.query(
    `SELECT id FROM records_consents
     WHERE patient_id = $1
       AND lower(recipient_name) = lower($2)
       ${emailClause}AND revoked_at IS NULL
       AND expires_at > now()
       AND record_types @> $3::text[]
     ORDER BY granted_at DESC
     LIMIT 1`,
    params
  );
  if (rows[0]) return { ok: true, consentId: rows[0].id };
  return {
    ok: false,
    reason: `No consent on file for "${trimmedRecipient}"${recipientEmail ? ` at ${String(recipientEmail).trim()}` : ''} covering ${recordTypes.join(', ')} for this child — log one on the child's Consents screen before sending.`,
  };
}

module.exports = { checkConsent };
