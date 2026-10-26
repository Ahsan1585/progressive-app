-- backend/db/migrations/add_date_change_resign.sql
--
-- Changing the date on a session note the parent already signed needs the
-- parent's new signature (see src/utils/dateChangeResign.js). The pending
-- edit rides on telepractice_signature_requests as kind = 'date_change'
-- (same secure link, DOB check, attestation and resend), and the note is
-- held from billing as billing_status = 'awaiting_resign' until the parent
-- signs; SEVF/invoice generation only ever selects pending/njeis_review.
--
-- Runs against each tenant's own database. Applied idempotently to every
-- tenant on every boot via runMigrations.js (see db/migrations/index.js),
-- so this file must stay safe to re-run.

ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'telepractice';
-- History kept for audit: what the note said, and who signed it, before.
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS previous_service_date date;
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS previous_parent_signature text;
-- Where the note goes back to on Undo ('pending' or 'rejected').
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS previous_billing_status text;
-- The rest of the edit that is applied when the parent signs (session
-- notes, company affiliation, a resubmit note).
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS edit_payload jsonb;

DO $$
DECLARE c record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telepractice_signature_requests_kind_check') THEN
    ALTER TABLE telepractice_signature_requests ADD CONSTRAINT telepractice_signature_requests_kind_check
      CHECK (kind = ANY (ARRAY['telepractice'::text, 'date_change'::text]));
  END IF;

  -- Lifecycle gains 'cancelled' (Undo date change). The original CHECK was
  -- declared inline, so find it by what it checks rather than by name.
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'telepractice_signature_requests'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%awaiting_signature%'
  LOOP
    EXECUTE format('ALTER TABLE telepractice_signature_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE telepractice_signature_requests ADD CONSTRAINT telepractice_signature_requests_status_check
    CHECK (status = ANY (ARRAY['awaiting_signature'::text, 'signed'::text, 'completed'::text, 'cancelled'::text]));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessments_billing_status_check') THEN
    ALTER TABLE assessments DROP CONSTRAINT assessments_billing_status_check;
  END IF;
  ALTER TABLE assessments ADD CONSTRAINT assessments_billing_status_check
    CHECK (billing_status = ANY (ARRAY[
      'pending'::text, 'njeis_review'::text, 'invoiced'::text,
      'on_hold'::text, 'rejected'::text, 'declined'::text,
      'self_certified'::text, 'completed'::text, 'voided'::text,
      'locked_in_report'::text, 'awaiting_resign'::text
    ]));
END $$;

-- At most one open re-sign request per note.
CREATE UNIQUE INDEX IF NOT EXISTS idx_date_change_one_open_per_assessment
  ON telepractice_signature_requests(assessment_id)
  WHERE kind = 'date_change' AND status = 'awaiting_signature';
