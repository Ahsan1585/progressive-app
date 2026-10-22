-- In-app "Send records": a staff member sends the records a signed consent
-- approves to the consent's recipient through an expiring secure link. The
-- recipient proves access to the consented mailbox with a one-time code before
-- anything downloads (see recordsReleaseController.js). Only sha256 hashes of
-- the link token and the code are stored. The packet is generated fresh at
-- download time, so revoking the consent ends access immediately.
CREATE TABLE IF NOT EXISTS records_releases (
  id serial PRIMARY KEY,
  consent_id integer NOT NULL REFERENCES records_consents(id) ON DELETE CASCADE,
  patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  record_types text[] NOT NULL,
  sent_by integer REFERENCES practitioners(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  email_status text NOT NULL DEFAULT 'sent' CHECK (email_status IN ('sent', 'failed')),
  code_hash text,
  code_expires_at timestamptz,
  code_sent_at timestamptz,
  code_attempts integer NOT NULL DEFAULT 0,
  code_sends integer NOT NULL DEFAULT 0,
  first_downloaded_at timestamptz,
  download_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS records_releases_consent_id_idx ON records_releases (consent_id);
CREATE INDEX IF NOT EXISTS records_releases_patient_id_idx ON records_releases (patient_id);
