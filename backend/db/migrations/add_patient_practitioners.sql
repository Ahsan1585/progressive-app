-- patients.child_id being globally unique meant once one practitioner
-- registered a child, no other practitioner could ever register that same
-- child — even though multiple practitioners legitimately serve the same
-- child for different services (e.g. one for speech therapy, another for
-- OT). Rather than duplicating the patient record per practitioner, this
-- join table lets any number of practitioners share the SAME patients row
-- (same demographic record, same child_id) while each practitioner's own
-- encounter history (assessments.practitioner_id) stays exactly as private
-- as it already was.
--
-- `status` (active/inactive) lives here, not on patients — one practitioner
-- marking a shared child inactive must not affect any other practitioner's
-- own relationship with that same child.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, and
-- INSERT...ON CONFLICT DO NOTHING all re-run safely on every boot.
CREATE TABLE IF NOT EXISTS patient_practitioners (
  patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  practitioner_id integer NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, practitioner_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_practitioners_status_check'
  ) THEN
    ALTER TABLE patient_practitioners
      ADD CONSTRAINT patient_practitioners_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

-- Backfill: every existing patients row's own practitioner_id becomes its
-- first (and, until now, only) attachment, inheriting that row's existing
-- status.
INSERT INTO patient_practitioners (patient_id, practitioner_id, status)
SELECT id, practitioner_id, status FROM patients WHERE practitioner_id IS NOT NULL
ON CONFLICT (patient_id, practitioner_id) DO NOTHING;
