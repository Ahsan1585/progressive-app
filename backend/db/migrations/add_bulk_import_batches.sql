-- Persists a bulk practitioner import's skipped rows so an admin can leave
-- the Bulk Register tab (or refresh the page) mid-import and come back
-- later to fix/dismiss what's left, instead of losing that work — the
-- results screen's fix-up table used to live only in React state.
--
-- One row per confirmPractitionerImport call that produced at least one
-- skipped row. skipped_rows holds the same shape the fix-up table already
-- renders: [{ row, reason, data, dismissed }, ...]. A row is considered
-- resolved once it's either removed (successfully registered via retry) or
-- flagged dismissed: true; the batch's own status flips to 'resolved' once
-- every entry is one or the other (checked in application code, not a DB
-- trigger, to keep the resolution rule easy to change later).
CREATE TABLE IF NOT EXISTS bulk_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by integer REFERENCES practitioners(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  file_name text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'discarded')),
  skipped_rows jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_bulk_import_batches_status ON bulk_import_batches (status);
