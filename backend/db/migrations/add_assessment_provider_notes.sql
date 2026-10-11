-- A session log's own single, editable note — the practitioner's private
-- record of what progress was made with the child during this session.
-- Fully separate from assessment_notes (the append-only billing-review
-- thread between a practitioner and a tenant company's billing staff) —
-- never read or written by anything that touches assessment_notes. Starts
-- NULL for every existing log; nothing is backfilled from assessment_notes.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS session_notes text;
