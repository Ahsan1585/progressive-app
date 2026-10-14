-- backend/db/migrations/add_correction_requests.sql
--
-- Tracks a parent/guardian's request to correct a child's early
-- intervention record, distinct from a practitioner silently editing a
-- session log (editLog in patientController.js). IDEA Part C requires a
-- formal amendment process with a reviewable outcome (34 CFR 303.410-413,
-- modeled on FERPA's own amendment-hearing provisions at 34 CFR 99.20-22) —
-- a plain log_edit audit row has no "who asked", "what did they ask for",
-- or "was it accepted" trail, which this table exists to hold.
--
-- Deliberately NOT a new assessments column: a correction request can be
-- made (and denied, or left pending) without ever touching the underlying
-- record, and one child can accumulate several requests over time across
-- different logs — this is its own append-mostly history, not session
-- metadata.
--
-- Runs against each tenant's own database. Applied idempotently to every
-- tenant on every boot via runMigrations.js (see db/migrations/index.js),
-- so this file must stay safe to re-run.
--
-- Apply with: psql "<tenant connection string>" -f backend/db/migrations/add_correction_requests.sql

CREATE TABLE IF NOT EXISTS correction_requests (
  id serial PRIMARY KEY,

  patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- Optional: the specific session log the request concerns, when the
  -- parent is pointing at one entry rather than the record generally.
  -- Nullable and ON DELETE SET NULL (not CASCADE) — if the underlying log
  -- is later deleted, the correction-request row and its decision history
  -- must survive as part of the child's own record, same reasoning as
  -- telepractice_signature_requests.assessment_id being kept after
  -- promotion.
  assessment_id integer REFERENCES assessments(id) ON DELETE SET NULL,

  -- Who logged the request on the parent's behalf (a practitioner or
  -- admin takes the call/email and records it here — there is no
  -- unauthenticated parent-facing form for this, consistent with every
  -- other parent-rights flow in this codebase being agency-mediated).
  requested_by integer NOT NULL REFERENCES practitioners(id),
  requested_at timestamptz NOT NULL DEFAULT now(),

  -- What the parent/guardian is asking to have corrected, in their own
  -- words as relayed by staff.
  request_note text NOT NULL,

  -- Review outcome. 'pending' until a CEO/admin with the corrections
  -- permission decides it; same accept/deny-with-note shape as
  -- billingController.decideMissingInEims.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'denied'::text])),

  reviewed_by integer REFERENCES practitioners(id),
  reviewed_at timestamptz,
  decision_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Per-child history (the "corrections" panel for one patient) and the
-- pending-review queue are the two access patterns this table serves.
CREATE INDEX IF NOT EXISTS idx_correction_requests_patient_id
  ON correction_requests(patient_id);

CREATE INDEX IF NOT EXISTS idx_correction_requests_status
  ON correction_requests(status);
