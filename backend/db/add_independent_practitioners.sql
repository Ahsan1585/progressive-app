-- Standalone one-off migration for the existing izaya_platform database —
-- same convention as add_promo_codes.sql (njeis_app owns these new
-- columns outright even though it doesn't own the pre-existing
-- companies/pending_signups tables themselves).
--
-- Adds the account_type discriminator that distinguishes a registered
-- tenant company from an individually-registered independent practitioner
-- (see docs/KNOWLEDGE_TRANSFER.md and the independent-practitioner plan).
-- Both account types are still just one row in `companies` with their own
-- tenant_<slug> database — account_type is consulted only by registration-
-- flow branching, platform-admin filtering, and pricing-engine selection,
-- never by tenant-side application code.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'tenant';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_account_type_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_account_type_check
      CHECK (account_type = ANY (ARRAY['tenant'::text, 'independent'::text]));
  END IF;
END $$;

-- pending_signups needs the same discriminator so confirmSignup/
-- confirmIndependentSignup know which provisioning branch ran, plus the
-- independent-practitioner-specific fields collected at signup time
-- (nullable — a tenant-company signup never fills these).
ALTER TABLE pending_signups
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'tenant';
ALTER TABLE pending_signups
  ADD COLUMN IF NOT EXISTS discipline text;
ALTER TABLE pending_signups
  ADD COLUMN IF NOT EXISTS pay_rate numeric(10,2);
