-- Expiring, token-gated secure download links for disclosing a child's
-- SEVF (+ invoice) to an outside agency, replacing PDF email attachments
-- (Resend cannot sign a BAA, so documents must not pass through it). Only
-- the sha256 hash of the token is stored, never the raw token. See
-- backend/src/controllers/sharedDocumentController.js.
CREATE TABLE IF NOT EXISTS shared_document_links (
  id serial PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  batch_id uuid NOT NULL REFERENCES billing_batches(id) ON DELETE CASCADE,
  patient_id integer REFERENCES patients(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  created_by integer REFERENCES practitioners(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  first_downloaded_at timestamptz,
  download_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS shared_document_links_batch_id_idx ON shared_document_links (batch_id);
CREATE INDEX IF NOT EXISTS shared_document_links_patient_id_idx ON shared_document_links (patient_id);
