-- backend/db/migrations/add_signature_attestation.sql
--
-- E-signature legal elements for the telepractice parent signature
-- (34 CFR 303.414 / 99.30(d)): explicit approval indication, the exact
-- statement of legal effect shown, server-side signing metadata, plus the
-- DOB identity-check lock state. Idempotent; runs against each tenant DB.

ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS attested boolean NOT NULL DEFAULT false;
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS attestation_text text;
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS signed_ip text;
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS signed_user_agent text;
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS dob_verified_at timestamptz;
-- signed_at already exists (set server-side with now() on signing).
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS verify_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS verify_locked_at timestamptz;

-- signed_at is immutable once set.
CREATE OR REPLACE FUNCTION telepractice_sig_signed_at_immutable() RETURNS trigger AS $fn$
BEGIN
  IF OLD.signed_at IS NOT NULL AND NEW.signed_at IS DISTINCT FROM OLD.signed_at THEN
    NEW.signed_at := OLD.signed_at;
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_telepractice_sig_signed_at_immutable ON telepractice_signature_requests;
CREATE TRIGGER trg_telepractice_sig_signed_at_immutable
  BEFORE UPDATE ON telepractice_signature_requests
  FOR EACH ROW EXECUTE FUNCTION telepractice_sig_signed_at_immutable();
