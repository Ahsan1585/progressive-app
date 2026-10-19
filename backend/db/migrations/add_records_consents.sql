-- FERPA/IDEA Part C §99.30 & §303.414 — prior written parental consent is
-- required before disclosing a child's records to a third party outside
-- the Part C system. One row per consent grant: which records, for what
-- purpose, to which specific recipient, with revocation and expiration.
-- See docs/superpowers/specs/2026-10-19-records-consent-design.md.
CREATE TABLE IF NOT EXISTS records_consents (
  id serial PRIMARY KEY,
  patient_id integer NOT NULL REFERENCES patients(id),
  recipient_name text NOT NULL,
  purpose text NOT NULL,
  record_types text[] NOT NULL,
  granted_by integer NOT NULL REFERENCES practitioners(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by integer REFERENCES practitioners(id),
  proof_note text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_consents_record_types_check'
  ) THEN
    ALTER TABLE records_consents ADD CONSTRAINT records_consents_record_types_check
      CHECK (record_types <@ ARRAY['session_logs','sevf_forms','invoices','full_record_export']::text[]);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_consents_record_types_nonempty_check'
  ) THEN
    ALTER TABLE records_consents ADD CONSTRAINT records_consents_record_types_nonempty_check
      CHECK (cardinality(record_types) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS records_consents_patient_id_idx ON records_consents (patient_id);
