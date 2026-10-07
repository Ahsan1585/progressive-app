-- Standalone one-off migration for the existing izaya_platform database —
-- same convention as add_independent_practitioners.sql (njeis_app owns
-- these new columns outright even though it doesn't own the pre-existing
-- pending_signups table itself).
--
-- Extends the independent-practitioner signup flow to collect more than one
-- discipline (practitioners.service_types is already an array column — only
-- signup itself was single-value) and an optional list of custom dropdown
-- options the practitioner wants added to their new tenant on day one, so
-- "customize your vocabulary" can happen during registration instead of
-- requiring a second trip into Company Information -> Dropdown Options
-- after confirming. Both nullable — a tenant-company signup never fills
-- these, and an independent signup with no custom options just leaves the
-- jsonb column null.
ALTER TABLE pending_signups
  ADD COLUMN IF NOT EXISTS disciplines text[];
ALTER TABLE pending_signups
  ADD COLUMN IF NOT EXISTS custom_dropdown_options jsonb;

-- Backfill: the old single-value `discipline` column stays in place
-- (nothing reads it going forward, but dropping a column on a live table
-- during a backend rollout is unnecessary risk for zero benefit) — any
-- already-pending (unconfirmed) signup row gets its one discipline name
-- copied into the new array so a signup started right before this deploy
-- and confirmed right after still provisions with its discipline intact.
UPDATE pending_signups
  SET disciplines = ARRAY[discipline]
  WHERE discipline IS NOT NULL AND disciplines IS NULL;
