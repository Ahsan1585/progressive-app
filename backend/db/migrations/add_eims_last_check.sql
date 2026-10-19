-- Persists the most recent Compliance Analysis verdict per session, so the
-- practitioner queue can show "N not matching EIMS" on a collapsed row
-- after a refresh or for a different billing specialist — previously this
-- only lived in the bulk-run caller's own React state, gone on reload and
-- invisible to anyone else.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_last_checked_at timestamptz;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_last_flagged boolean;
