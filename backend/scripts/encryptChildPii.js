// One-time backfill: encrypts plaintext patients.{first_name, last_name,
// middle_name, dob} and assessments.{patient_first_name, patient_last_name,
// patient_dob, session_notes} already stored in a tenant database, using
// the same AES-256-GCM scheme the app now applies on every new write (see
// fieldEncryption.js). Run manually, once per tenant, AFTER
// add_child_pii_encryption.sql has applied. Also computes and stores the
// blind-index HMAC for first_name/last_name on both tables.
//
// Safe to re-run: any row whose target column already starts with "v1:" is
// skipped for that column, so running this twice is a no-op the second time.
//
// Usage (from backend/, with the Cloud SQL Auth Proxy running on
// 127.0.0.1:5433):
//   FIELD_ENCRYPTION_KEY=<key> FIELD_INDEX_KEY=<key> node scripts/encryptChildPii.js <tenant_db_name>
const { Pool } = require('pg');
const { encryptFieldIfNeeded: encryptIfNeeded, hmacIndexFromEitherForm: hmacIndexOf } = require('../src/utils/fieldEncryption');

const ALREADY_DONE = (v) => typeof v === 'string' && v.startsWith('v1:');

async function main() {
  const tenantDbName = process.argv[2];
  if (!tenantDbName) {
    console.error('Usage: node scripts/encryptChildPii.js <tenant_db_name>');
    process.exit(1);
  }
  if (!process.env.FIELD_ENCRYPTION_KEY || !process.env.FIELD_INDEX_KEY) {
    console.error('FIELD_ENCRYPTION_KEY and FIELD_INDEX_KEY must both be set to the values the running app uses.');
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
    const { rows: patients } = await pool.query(
      `SELECT id, first_name, last_name, middle_name, dob FROM patients`
    );
    let patientsDone = 0;
    for (const row of patients) {
      const alreadyFullyDone = ALREADY_DONE(row.first_name) && ALREADY_DONE(row.last_name)
        && (row.middle_name == null || ALREADY_DONE(row.middle_name))
        && (row.dob == null || ALREADY_DONE(row.dob));
      if (alreadyFullyDone) continue;
      await pool.query(
        `UPDATE patients SET first_name = $1, last_name = $2, middle_name = $3, dob = $4,
                first_name_idx = $5, last_name_idx = $6 WHERE id = $7`,
        [
          encryptIfNeeded(row.first_name),
          encryptIfNeeded(row.last_name),
          encryptIfNeeded(row.middle_name),
          encryptIfNeeded(row.dob),
          hmacIndexOf(row.first_name),
          hmacIndexOf(row.last_name),
          row.id,
        ]
      );
      patientsDone += 1;
    }

    const { rows: assessments } = await pool.query(
      `SELECT id, patient_first_name, patient_last_name, patient_dob, session_notes FROM assessments`
    );
    let assessmentsDone = 0;
    for (const row of assessments) {
      const alreadyFullyDone = ALREADY_DONE(row.patient_first_name) && ALREADY_DONE(row.patient_last_name)
        && (row.patient_dob == null || ALREADY_DONE(row.patient_dob))
        && (row.session_notes == null || ALREADY_DONE(row.session_notes));
      if (alreadyFullyDone) continue;
      await pool.query(
        `UPDATE assessments SET patient_first_name = $1, patient_last_name = $2, patient_dob = $3,
                session_notes = $4, patient_first_name_idx = $5, patient_last_name_idx = $6 WHERE id = $7`,
        [
          encryptIfNeeded(row.patient_first_name),
          encryptIfNeeded(row.patient_last_name),
          encryptIfNeeded(row.patient_dob),
          encryptIfNeeded(row.session_notes),
          hmacIndexOf(row.patient_first_name),
          hmacIndexOf(row.patient_last_name),
          row.id,
        ]
      );
      assessmentsDone += 1;
    }

    console.log(`Encrypted ${patientsDone} patients rows, ${assessmentsDone} assessments rows.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
