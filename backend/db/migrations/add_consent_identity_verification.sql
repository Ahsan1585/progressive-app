-- FERPA 34 CFR 99.30/99.31(c): identity of the person giving consent must be
-- authenticated. Nullable so pre-existing consents stay valid; the API
-- requires it for new consents.
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS identity_verified_method text;
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS identity_verified_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_consents_identity_method_check') THEN
    ALTER TABLE records_consents ADD CONSTRAINT records_consents_identity_method_check
      CHECK (identity_verified_method IS NULL OR identity_verified_method IN ('known_parent','photo_id','callback_verified','in_person','other'));
  END IF;
END $$;
