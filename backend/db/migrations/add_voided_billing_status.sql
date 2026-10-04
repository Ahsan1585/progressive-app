-- backend/db/migrations/add_voided_billing_status.sql
--
-- Adds 'voided' to assessments.billing_status's allowed values —
-- independent-practitioner-only: once a SEVF/invoice has already been
-- generated for a session (billing_status='completed'), the session can no
-- longer be edited or deleted (the documents are already generated/sent),
-- but the practitioner can still flag it as a mistake via "Reject" —
-- excluding it from hour/revenue totals going forward as a zero-value
-- session, WITHOUT touching the already-generated SEVF/invoice files or the
-- billing_batches row they belong to (those stay exactly as sent; this is
-- a forward-looking correction, not a retroactive revert — see
-- revertSelfCertifiedSEVF for the separate, existing "undo the whole batch"
-- flow, which this does not replace).
--
-- Deliberately a new distinct value, not a reuse of the existing
-- 'rejected' — that value already means something different and
-- reversible in the tenant office-review flow (Returned, awaiting
-- practitioner revision+resubmit via resubmitLog), which a tenant
-- practitioner's logs can still legitimately be in. Reusing it here would
-- collide with that flow's own semantics for any code that isn't aware of
-- the independent-practitioner path.
--
-- Idempotent: safe to re-run on every boot and as part of a brand-new
-- tenant's initial provisioning, matching every other file in this
-- directory. Re-applying this exact ALTER CONSTRAINT (dropping the one
-- add_independent_practitioner_support.sql's own re-run already re-added)
-- is deliberately redundant with that file rather than editing it in
-- place — this migration runs strictly after it in MIGRATIONS, so its own
-- narrower list always wins as the final word on every boot.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assessments_billing_status_check'
  ) THEN
    ALTER TABLE assessments DROP CONSTRAINT assessments_billing_status_check;
  END IF;
  ALTER TABLE assessments ADD CONSTRAINT assessments_billing_status_check
    CHECK (billing_status = ANY (ARRAY[
      'pending'::text, 'njeis_review'::text, 'invoiced'::text,
      'on_hold'::text, 'rejected'::text, 'declined'::text,
      'self_certified'::text, 'completed'::text, 'voided'::text
    ]));
END $$;
