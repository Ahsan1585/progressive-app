// One-time backfill: encrypts any plaintext practitioners.ssn values
// already stored in a tenant database, using the same AES-256-GCM scheme
// insertInvitedPractitioner/updateStaffProfile now apply on every new
// write (see backend/src/utils/fieldEncryption.js). Run this manually,
// once per tenant, AFTER the widen_ssn_column_for_encryption.sql migration
// has applied (needs the column to be `text`, not `varchar(11)`, before an
// encrypted value can fit) — same manual-run convention as this repo's
// other one-off data migrations (e.g. backend/db/add_promo_codes.sql).
//
// Safe to re-run: any row whose ssn already starts with the "v1:" prefix
// (see fieldEncryption.js) is skipped, so running this twice against the
// same tenant is a no-op the second time, not a double-encryption bug.
//
// Usage (from backend/, with the Cloud SQL Auth Proxy already running on
// 127.0.0.1:5433 — see the project's own Cloud SQL proxy workflow):
//   FIELD_ENCRYPTION_KEY=<the real key> node scripts/encryptExistingSsns.js <tenant_db_name>
//
// Requires DB_USER/DB_PASSWORD (or a full connection string edited in
// below) for the target database, and FIELD_ENCRYPTION_KEY set to the
// SAME key the running app uses — encrypting with a different key than
// what's configured in production would make these rows undecryptable by
// the live app.
const { Pool } = require('pg');
const { encryptField } = require('../src/utils/fieldEncryption');

async function main() {
  const tenantDbName = process.argv[2];
  if (!tenantDbName) {
    console.error('Usage: node scripts/encryptExistingSsns.js <tenant_db_name>');
    process.exit(1);
  }
  if (!process.env.FIELD_ENCRYPTION_KEY) {
    console.error('FIELD_ENCRYPTION_KEY must be set to the same key the running app uses.');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    user: process.env.DB_USER || 'njeis_app',
    password: process.env.DB_PASSWORD,
    database: tenantDbName,
  });

  try {
    const { rows } = await pool.query(
      `SELECT id, ssn FROM practitioners WHERE ssn IS NOT NULL AND ssn != ''`
    );

    let encryptedCount = 0;
    let alreadyDoneCount = 0;

    for (const row of rows) {
      if (String(row.ssn).startsWith('v1:')) {
        alreadyDoneCount += 1;
        continue;
      }
      const encrypted = encryptField(row.ssn);
      await pool.query('UPDATE practitioners SET ssn = $1 WHERE id = $2', [encrypted, row.id]);
      encryptedCount += 1;
    }

    console.log(`Tenant "${tenantDbName}": ${encryptedCount} SSN(s) encrypted, ${alreadyDoneCount} already encrypted (skipped), ${rows.length} total rows with an SSN.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
