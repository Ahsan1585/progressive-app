-- Adds tenant-database support for the "independent practitioner" account
-- type — a practitioner registered directly with Izaya (no tenant company),
-- provisioned via the exact same per-tenant database pipeline. See the
-- independent-practitioner plan (docs, or ask the team) for full context.
--
-- Idempotent: safe to re-run on every boot (runMigrations.js) and safe as
-- part of a brand-new tenant's initial provisioning (tenantProvisioning.js),
-- matching every other file in this directory.

-- practitioners.role currently allows only 'practitioner'/'ceo'/'staff'.
-- An independent practitioner's single practitioners row is simultaneously
-- "CEO of their own single-seat company" and "the practitioner logging
-- sessions" — a third role value, not a reuse of either existing one, since
-- downstream code needs to tell the two apart (see authMiddleware.js).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practitioners_role_check'
  ) THEN
    ALTER TABLE practitioners DROP CONSTRAINT practitioners_role_check;
  END IF;
  ALTER TABLE practitioners ADD CONSTRAINT practitioners_role_check
    CHECK (role = ANY (ARRAY['practitioner'::text, 'ceo'::text, 'staff'::text, 'independent_practitioner'::text]));
END $$;

-- assessments.billing_status has never had a CHECK constraint (just a
-- DEFAULT) — adding one now, tightening for every tenant, allowing every
-- value already in use tenant-wide plus the two new independent-
-- practitioner-only values:
--   'self_certified' — an independent practitioner's own equivalent of
--     'njeis_review': the log is immediately SEVF-generation-eligible,
--     since there is no office reviewer to advance it out of 'pending'.
--   'completed'      — an independent practitioner's own equivalent of
--     'invoiced': set the moment a SEVF is generated for that log (generate
--     and finalize are the same action for this role — no separate
--     complete-billing step, since there's no pay invoice to issue).
-- Neither value is ever written for a normal tenant practitioner's logs.
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
      'self_certified'::text, 'completed'::text,
      -- 'voided' and 'locked_in_report' are added by their own later
      -- migrations (add_voided_billing_status.sql; 'locked_in_report' has
      -- no migration of its own, see that file's comment) — included here
      -- too so THIS constraint, which every boot re-applies first and
      -- which runs strictly in MIGRATIONS order before the later one
      -- widens it again, is never narrower than data a tenant may already
      -- have on file from a previous boot. Without this, any tenant with
      -- a 'voided' row fails to boot at all on this earlier ALTER, before
      -- ever reaching the migration that's supposed to allow it.
      'voided'::text, 'locked_in_report'::text
    ]));
END $$;

-- Company affiliation — which early intervention agency a given session is
-- billed to — is captured PER SESSION LOG, not on the patient record. A
-- child seen by an independent practitioner can be billed to different
-- agencies across different sessions, even concurrently, so a single fixed
-- value on `patients` can't represent that; each log independently states
-- its own billing target. Only meaningful for an independent practitioner's
-- own single-seat database (a normal tenant company's own office-review
-- billing flow never reads or writes this column), but it exists
-- unconditionally on every tenant so schema.sql/this migration never need
-- an "if independent" branch.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS company_affiliation text;

-- Patient-level "last used" affiliation — purely a UX default so an
-- independent practitioner isn't retyping/reselecting the same agency name
-- on every session for the same child. Never authoritative for SEVF
-- grouping (assessments.company_affiliation is) — just seeds the
-- log-session form's default value, updated each time a session is logged.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS last_company_affiliation text;

-- Mirrors assessments.company_affiliation onto the telepractice signature-
-- request table, which holds a session's full payload (mirroring
-- assessments' loggable fields — see add_telepractice_signature_requests.sql's
-- own header comment) while awaiting the parent's remote signature. Without
-- this, a telehealth session logged by an independent practitioner would
-- lose its company affiliation the moment confirmTelepracticeSession()
-- copies the request's fields into a real assessments row.
ALTER TABLE telepractice_signature_requests ADD COLUMN IF NOT EXISTS company_affiliation text;

-- Flat monthly price for an independent practitioner's own subscription —
-- unused/irrelevant for a normal tenant company (which uses the existing
-- subscription_price_per_practitioner/subscription_included_staff_seats/
-- subscription_extra_staff_seat_price trio instead, seeded by
-- add_subscription_billing.sql). Read only when account_type='independent'
-- (see computeFlatRatePeriodSummary in subscriptionBilling.js). Platform
-- admin can override it per-practitioner the same way per-company pricing
-- is already overridden (platformAdminController.js's setCompanyPricing).
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS subscription_flat_price numeric(10,2) NOT NULL DEFAULT 30.00;

-- subscription_invoices' per-seat columns (active_practitioner_count,
-- price_per_practitioner, etc.) are all NOT NULL with no way to represent
-- "not applicable" — an independent practitioner's flat-rate invoice row
-- still has to fill them (with 0 / the flat price, see closePeriodInvoice
-- in subscriptionController.js), so this column makes the row
-- self-describing rather than leaving a reader to infer "flat-rate" from
-- a pattern of zeros. Defaults to 'tenant' so every pre-existing row reads
-- correctly without a backfill.
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'tenant';
