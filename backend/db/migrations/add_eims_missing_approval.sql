-- A log with no matching state record ("Missing in EIMS") requires an
-- explicit admin (ceo) approval before billing can approve it — a separate,
-- auditable gate from the per-field "Allow" flow used for mismatches.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_missing_approved_by integer REFERENCES practitioners(id);
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_missing_approved_at timestamptz;
