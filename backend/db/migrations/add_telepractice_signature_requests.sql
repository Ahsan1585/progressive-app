-- backend/db/migrations/add_telepractice_signature_requests.sql
--
-- Holds a telepractice session log's full payload (mirrors assessments'
-- loggable fields) while it's awaiting the parent's remote signature, then
-- again briefly while it's awaiting the practitioner's Confirm & Submit.
-- Deliberately NOT session_drafts (different lifecycle: this row is created
-- complete except for one signature, is emailed out of the app, and is
-- driven to completion by an external, unauthenticated actor — not an
-- in-progress edit the practitioner is still actively working on) and NOT
-- a relaxation of assessments' NOT NULL signature constraints (a session
-- must never be billing-visible with a missing signature).
--
-- Runs against each tenant's own database (this table is queried under
-- tenant context resolved from the company slug in the parent-signing URL,
-- since a parent has no JWT to carry tenant info any other way) — NOT
-- izaya_platform. Applied idempotently to every tenant on every boot via
-- runMigrations.js (see db/migrations/index.js), so this file must stay
-- safe to re-run.
--
-- Apply with: psql "<tenant connection string>" -f backend/db/migrations/add_telepractice_signature_requests.sql

CREATE TABLE IF NOT EXISTS telepractice_signature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  practitioner_id integer NOT NULL REFERENCES practitioners(id),
  patient_id integer NOT NULL REFERENCES patients(id),

  -- Denormalized snapshot, same convention as assessments' own denormalized
  -- columns (practitioner/patient identity can change after the fact; the
  -- signed document must reflect what was true at logging time).
  patient_first_name text,
  patient_last_name text,
  patient_dob date,
  patient_county text,
  practitioner_first_name text,
  practitioner_last_name text,
  practitioner_discipline text,

  -- Loggable session fields — same set LogIntervention.tsx collects today,
  -- minus parent_signature. Named session_status (not "status") to avoid
  -- colliding with this table's own lifecycle `status` column below —
  -- assessments doesn't have that naming pressure since it has no lifecycle
  -- status of its own, only billing_status, which is a different column.
  service_date date,
  start_time text,
  end_time text,
  total_time integer,
  session_status text,
  type text,
  location text,
  group_size_category text,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,

  -- Signatures. practitioner_signature is captured and stored at submit
  -- time (same as a normal log) — only parent_signature is deferred.
  practitioner_signature text NOT NULL,
  parent_signature text,

  -- Where the email went — snapshot at send time, so a later change to
  -- patients.parent_email doesn't retroactively alter what a signed request
  -- says it was sent to, and so the parent-facing GET never needs to touch
  -- the patients table at all.
  parent_email text NOT NULL,

  -- Lifecycle: awaiting_signature -> signed -> completed. 'expired' is a
  -- read/display-time derivation (token_expires < now() AND status =
  -- 'awaiting_signature'), not stored — avoids a background job just to
  -- flip a status column; resend regenerates the token/expiry either way.
  status text NOT NULL DEFAULT 'awaiting_signature'
    CHECK (status = ANY (ARRAY['awaiting_signature'::text, 'signed'::text, 'completed'::text])),

  -- Secure token pattern, identical to practitioners.reset_token_hash /
  -- reset_token_expires (authController.js) — never store the raw token,
  -- only its SHA-256 hash. Regenerated on every resend.
  token_hash text NOT NULL,
  token_expires timestamptz NOT NULL,

  -- Audit timestamps.
  sent_at timestamptz NOT NULL DEFAULT now(),
  resent_at timestamptz,
  resend_count integer NOT NULL DEFAULT 0,
  signed_at timestamptz,
  completed_at timestamptz,

  -- Set once Confirm & Submit runs — the resulting real, billing-visible
  -- assessments row. NULL until status = 'completed'. Row is kept (not
  -- deleted) after promotion, for audit trail.
  assessment_id integer REFERENCES assessments(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Token lookups happen on every parent GET/POST (unauthenticated, so this
-- is the only thing standing between a request and a full table scan).
CREATE INDEX IF NOT EXISTS idx_telepractice_sig_req_token_hash
  ON telepractice_signature_requests(token_hash);

-- Practitioner's own in-flight list (Inbox "Ready to submit" + Patient
-- Detail "Awaiting parent signature") — filtered by practitioner + status.
CREATE INDEX IF NOT EXISTS idx_telepractice_sig_req_practitioner_status
  ON telepractice_signature_requests(practitioner_id, status);
