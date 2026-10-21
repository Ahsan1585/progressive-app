-- FERPA 34 CFR 99.30 / IDEA Part C 303.414 — two ways a disclosure consent
-- gets on file:
--   (A) the parent e-signs it from a link-only email (records_consent_requests
--       holds the request until signed; signing inserts the records_consents
--       row), or
--   (B) staff record a consent the parent already signed on paper
--       (records_consents.source = 'paper').
-- A pending request NEVER authorizes a disclosure: checkConsent reads
-- records_consents only.
--
-- Runs against each tenant's own database; the public signing routes resolve
-- the tenant from the company slug in the URL. Idempotent: safe to re-run on
-- every boot.

CREATE TABLE IF NOT EXISTS records_consent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id integer NOT NULL REFERENCES patients(id),
  recipient_name text NOT NULL,
  recipient_email text,
  purpose text NOT NULL,
  record_types text[] NOT NULL,
  consent_expires_at timestamptz NOT NULL,
  requested_by integer NOT NULL REFERENCES practitioners(id),
  -- Snapshot of where the link went (a later edit to patients.parent_email
  -- must not rewrite history); refreshed on resend.
  parent_email text NOT NULL,
  -- sha256 of the raw 32-byte token; the raw token only ever lives in the email.
  token_hash text UNIQUE NOT NULL,
  request_expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  verify_failed_attempts integer NOT NULL DEFAULT 0,
  verify_locked_at timestamptz,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  signed_name text,
  -- records_consents.id is a serial integer.
  consent_id integer REFERENCES records_consents(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_consent_requests_status_check') THEN
    ALTER TABLE records_consent_requests ADD CONSTRAINT records_consent_requests_status_check
      CHECK (status IN ('pending','signed','expired','cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_consent_requests_record_types_check') THEN
    ALTER TABLE records_consent_requests ADD CONSTRAINT records_consent_requests_record_types_check
      CHECK (record_types <@ ARRAY['session_logs','sevf_forms','invoices','full_record_export']::text[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_consent_requests_record_types_nonempty_check') THEN
    ALTER TABLE records_consent_requests ADD CONSTRAINT records_consent_requests_record_types_nonempty_check
      CHECK (cardinality(record_types) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS records_consent_requests_patient_id_idx ON records_consent_requests (patient_id);
CREATE INDEX IF NOT EXISTS records_consent_requests_status_idx ON records_consent_requests (status);

-- Provenance of each consent. source is NULL for rows that predate this
-- migration (manually logged, legacy).
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS signed_on date;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS paper_attested boolean;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS signed_ip text;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS signed_user_agent text;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS signed_name text;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES records_consent_requests(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_consents_source_check') THEN
    ALTER TABLE records_consents ADD CONSTRAINT records_consents_source_check
      CHECK (source IS NULL OR source IN ('paper','electronic'));
  END IF;
END $$;

-- Allow 'electronic_dob' (parent verified the child's DOB on the signing
-- page). Drop + re-add so the allowed list is always exactly this one,
-- whatever an earlier migration created; all previous values are kept.
DO $$
BEGIN
  ALTER TABLE records_consents DROP CONSTRAINT IF EXISTS records_consents_identity_method_check;
  ALTER TABLE records_consents ADD CONSTRAINT records_consents_identity_method_check
    CHECK (identity_verified_method IS NULL OR identity_verified_method IN ('known_parent','photo_id','callback_verified','in_person','other','electronic_dob'));
END $$;
