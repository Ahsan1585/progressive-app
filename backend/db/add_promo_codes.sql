-- Standalone one-off migration for the existing izaya_platform database —
-- extracted from platform-schema.sql (which also contains the full
-- `companies`/`pending_signups` definitions, unrunnable here since
-- njeis_app doesn't own those pre-existing tables). Safe to run as-is:
-- njeis_app creates and therefore owns these two new tables outright.

CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  days_extension integer NOT NULL,
  max_redemptions integer, -- NULL = unlimited
  redemption_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz, -- NULL = never expires
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_codes_code_key UNIQUE (code),
  CONSTRAINT promo_codes_days_extension_check CHECK (days_extension > 0)
);
CREATE INDEX IF NOT EXISTS promo_codes_code_idx ON promo_codes (code);

CREATE TABLE IF NOT EXISTS promo_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  days_extended integer NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_code_redemptions_unique_per_company UNIQUE (promo_code_id, company_id)
);
CREATE INDEX IF NOT EXISTS promo_code_redemptions_company_id_idx ON promo_code_redemptions (company_id);
