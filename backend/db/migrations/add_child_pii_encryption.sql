-- Manual, per-tenant migration (same convention as
-- widen_ssn_column_for_encryption.sql) — applied once per tenant database
-- via psql, BEFORE running backend/scripts/encryptChildPii.js.
--
-- Adds a "blind index" companion column per searched/sorted name column:
-- a deterministic HMAC-SHA256 digest (computed app-side with
-- FIELD_INDEX_KEY, never the same key as FIELD_ENCRYPTION_KEY) that lets
-- SQL do exact-match WHERE lookups against an encrypted column without
-- ever storing or querying the plaintext. No index column exists for
-- dob — it is never substring-searched, and the few exact-match/compare
-- use sites decrypt-and-compare in application code on small result sets.
--
-- Changes patients.dob and assessments.patient_dob from `date` to `text`
-- because an AES-256-GCM ciphertext string cannot be stored in a `date`
-- column. Confirmed safe: backend/src/config/tenantPoolRegistry.js already
-- forces every `date` column, app-wide, to be read back as a raw
-- "YYYY-MM-DD" string (not a JS Date) via a global pg type parser — so
-- every consumer of these two columns already treats them as strings,
-- this just makes the schema match what the app already assumes.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS first_name_idx text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS last_name_idx text;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS patient_first_name_idx text;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS patient_last_name_idx text;

CREATE INDEX IF NOT EXISTS idx_patients_first_name_idx ON patients (first_name_idx);
CREATE INDEX IF NOT EXISTS idx_patients_last_name_idx ON patients (last_name_idx);
CREATE INDEX IF NOT EXISTS idx_assessments_patient_first_name_idx ON assessments (patient_first_name_idx);
CREATE INDEX IF NOT EXISTS idx_assessments_patient_last_name_idx ON assessments (patient_last_name_idx);

ALTER TABLE patients ALTER COLUMN dob TYPE text;
ALTER TABLE assessments ALTER COLUMN patient_dob TYPE text;
