-- Separate from eims_last_flagged (a matched session with a field
-- mismatch): this tracks a session with NO matching EIMS record at all
-- ("Missing in EIMS"), so the practitioner queue can report the two
-- distinctly instead of only ever showing "not matching EIMS" for both.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_last_missing boolean;
