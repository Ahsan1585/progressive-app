-- Platform-admin accounts for izaya_platform — real email+password identity
-- replacing the old shared-secret (PLATFORM_ADMIN_KEY) gate on /platform-admin.
-- Manually applied (psql -f) like add_promo_codes.sql — izaya_platform has
-- no auto-migration framework the way each tenant DB does.
--
-- totp_secret is unused for now; left nullable so 2FA can be added as a
-- fast-follow without another migration.
CREATE TABLE IF NOT EXISTS platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  totp_secret text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admins_email_key UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS platform_admins_email_idx ON platform_admins (email);
