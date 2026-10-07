-- backend/db/migrations/add_agencies.sql
--
-- Independent-practitioner-only: a real, practitioner-owned directory of
-- the early intervention agencies they bill to (name + contact email/phone/
-- address/notes), replacing the previous free-text-only agency entry
-- (assessments.company_affiliation stays exactly as-is — this table only
-- changes how that string gets picked, never its storage shape or the SEVF
-- grouping/generation logic that reads it).
--
-- Also adds patient_agencies, a many-to-many roster of which agencies a
-- given child is currently billed to, surfaced on Add/Edit Patient and as
-- fast-pick chips on the Log Session screen (one agency per session still —
-- the roster is just a shortlist, not a split-billing mechanism).
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_agencies.sql

CREATE TABLE IF NOT EXISTS agencies (
  id serial PRIMARY KEY,
  practitioner_id integer NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per practitioner, only enforced among active
-- rows — a soft-deleted agency's old name can be reused for a new one
-- without a conflict.
CREATE UNIQUE INDEX IF NOT EXISTS agencies_practitioner_name_unique
  ON agencies (practitioner_id, lower(name)) WHERE is_active;
CREATE INDEX IF NOT EXISTS agencies_practitioner_id_idx ON agencies (practitioner_id);

CREATE TABLE IF NOT EXISTS patient_agencies (
  patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  agency_id integer NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, agency_id)
);

-- One-time backfill: every distinct non-blank company_affiliation string
-- already on file (per practitioner) becomes a real agencies row, so
-- historical free-text agency names are immediately usable in the new
-- picker/roster UI without requiring the practitioner to re-create them.
-- Email starts NULL — filled in later via Manage Agencies or inline the
-- first time that agency's SEVF is emailed. Safe to re-run: the unique
-- index above makes a repeat INSERT for an already-backfilled name a no-op.
INSERT INTO agencies (practitioner_id, name)
SELECT DISTINCT practitioner_id, company_affiliation
FROM assessments
WHERE company_affiliation IS NOT NULL AND company_affiliation != ''
ON CONFLICT (practitioner_id, lower(name)) WHERE is_active DO NOTHING;
