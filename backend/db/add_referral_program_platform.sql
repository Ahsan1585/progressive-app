-- Standalone one-off migration for the existing izaya_platform database —
-- extracted from platform-schema.sql (which also contains the full
-- `companies`/`pending_signups` definitions, unrunnable here since the
-- running app doesn't own those pre-existing tables). Safe to run as-is:
-- this file only adds new columns/tables.
-- Apply once with: psql "<connection string, connected to izaya_platform>" -f backend/db/add_referral_program_platform.sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS referred_by_company_id uuid REFERENCES companies(id);

CREATE TABLE IF NOT EXISTS referral_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_company_id uuid NOT NULL REFERENCES companies(id),
  referred_company_id uuid NOT NULL REFERENCES companies(id),
  referred_display_name text NOT NULL,
  referred_first_waived_at timestamptz NOT NULL DEFAULT now(),
  referred_second_payment_at timestamptz,
  referrer_rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_redemptions_referred_unique UNIQUE (referred_company_id)
);
CREATE INDEX IF NOT EXISTS referral_redemptions_referrer_idx ON referral_redemptions (referrer_company_id);

ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS referred_by_code text;
