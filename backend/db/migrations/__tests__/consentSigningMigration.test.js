const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'add_consent_signing.sql'), 'utf8');

describe('add_consent_signing.sql', () => {
  test('creates records_consent_requests idempotently with the expected lifecycle columns', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS records_consent_requests/);
    for (const col of ['token_hash text', 'request_expires_at', 'verify_failed_attempts', 'verify_locked_at', 'signed_ip', 'signed_user_agent', 'signed_name', 'consent_id']) {
      expect(sql).toContain(col);
    }
    expect(sql).toMatch(/'pending','signed','expired','cancelled'/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS \w+ ON records_consent_requests \(patient_id\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS \w+ ON records_consent_requests \(status\)/);
  });

  test('reuses the records_consents record-type values', () => {
    expect(sql).toContain("ARRAY['session_logs','sevf_forms','invoices','full_record_export']::text[]");
  });

  test('adds the provenance columns to records_consents with IF NOT EXISTS', () => {
    for (const col of ['source', 'signed_on', 'paper_attested', 'signed_ip', 'signed_user_agent', 'signed_name', 'request_id']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
    expect(sql).toMatch(/source IS NULL OR source IN \('paper','electronic'\)/);
  });

  test("re-creates the identity method CHECK idempotently, keeping old values and adding 'electronic_dob'", () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS records_consents_identity_method_check/);
    expect(sql).toContain("'known_parent','photo_id','callback_verified','in_person','other','electronic_dob'");
    // Every constraint add is guarded by a DO block
    expect((sql.match(/DO \$\$/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
