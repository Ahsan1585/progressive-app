-- Consent lifecycle: parent self-service (view/withdraw/copy via a long-lived
-- manage link), expiry reminders, and an optional scan of a paper consent.
-- Idempotent; runs on every boot for every tenant.

-- Parent manage link: only the sha256 of the token is stored. Attempts at the
-- child's date of birth are counted separately from the signing link's.
ALTER TABLE records_consent_requests ADD COLUMN IF NOT EXISTS manage_token_hash text;
ALTER TABLE records_consent_requests ADD COLUMN IF NOT EXISTS manage_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE records_consent_requests ADD COLUMN IF NOT EXISTS manage_locked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS records_consent_requests_manage_token_hash_idx
  ON records_consent_requests (manage_token_hash) WHERE manage_token_hash IS NOT NULL;

-- Who ended the consent: 'staff' or 'parent' (NULL on rows revoked before this).
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS revoked_via text;

-- Expiry reminders, one per stage so a sweep can run any number of times.
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS reminded_30_at timestamptz;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS reminded_7_at timestamptz;

-- Optional scan of the signed paper form (object path in cloud storage).
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS paper_scan_path text;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS paper_scan_filename text;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS paper_scan_uploaded_at timestamptz;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS paper_scan_uploaded_by integer REFERENCES practitioners(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_consents_revoked_via_check') THEN
    ALTER TABLE records_consents ADD CONSTRAINT records_consents_revoked_via_check
      CHECK (revoked_via IS NULL OR revoked_via IN ('staff','parent'));
  END IF;
END $$;
