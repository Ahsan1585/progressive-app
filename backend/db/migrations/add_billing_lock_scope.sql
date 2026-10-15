-- Scopes a billing_locks row to a sub-group within one practitioner's
-- queue, not just the whole practitioner. Before this, locking was
-- (practitioner_id) alone: a specialist working "Needs review" sessions
-- and another specialist's "Sent to billing" (njeis_review, awaiting Send
-- to Completed) sessions for the SAME practitioner shared one lock row,
-- so completing the billed batch auto-unlocked via
-- POST /api/billing/practitioner/:id/unlock released the review
-- specialist's lock out from under them mid-review.
--
-- lock_scope values: 'review' (default — every pre-existing caller that
-- doesn't know about scopes locks/unlocks this one, so old behavior is
-- unchanged for a practitioner who isn't split into two queue cards) and
-- 'billed' (the "Sent to billing" card's own independent lock).
--
-- Runs on every boot against every tenant (see runMigrations.js) — every
-- statement below must be safe to re-execute once already applied.
ALTER TABLE billing_locks ADD COLUMN IF NOT EXISTS lock_scope text NOT NULL DEFAULT 'review';

-- Drop the old single-column PK (practitioner_id alone) and replace it
-- with one that includes scope, so (practitioner_id, 'review') and
-- (practitioner_id, 'billed') can both hold a row at once. Only drops/adds
-- once: on a re-run, the new PK already exists under its own name
-- (billing_locks_pkey is Postgres's default name for either shape, so the
-- IF NOT EXISTS check on the constraint itself — via pg_constraint — is
-- what makes this idempotent, not the name).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'billing_locks_pkey' AND contype = 'p'
      AND conkey = (
        SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
        WHERE attrelid = 'billing_locks'::regclass AND attname IN ('practitioner_id', 'lock_scope')
      )
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_locks_pkey' AND contype = 'p') THEN
      ALTER TABLE billing_locks DROP CONSTRAINT billing_locks_pkey;
    END IF;
    ALTER TABLE billing_locks ADD CONSTRAINT billing_locks_pkey PRIMARY KEY (practitioner_id, lock_scope);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_locks_lock_scope_check') THEN
    ALTER TABLE billing_locks ADD CONSTRAINT billing_locks_lock_scope_check CHECK (lock_scope IN ('review', 'billed'));
  END IF;
END $$;
