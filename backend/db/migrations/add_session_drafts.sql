-- backend/db/migrations/add_session_drafts.sql
--
-- Lets a practitioner save an in-progress session log (missing required
-- fields like a signature) and resume it later. Deliberately a separate
-- table from assessments — not just nullable columns on assessments — so a
-- draft is structurally incapable of ever showing up in billing, Compliance
-- Analysis, or Master Reports, all of which only ever query assessments.
--
-- One draft per (practitioner, child): saving a new draft for a child that
-- already has one overwrites it (see sessionDraftsController.js's upsert).
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_session_drafts.sql

CREATE TABLE IF NOT EXISTS session_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id integer NOT NULL REFERENCES practitioners(id),
  patient_id integer NOT NULL REFERENCES patients(id),
  form_data jsonb NOT NULL,
  parent_signature text,
  practitioner_signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_drafts_practitioner_patient_key UNIQUE (practitioner_id, patient_id)
);
