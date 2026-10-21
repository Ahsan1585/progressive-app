-- "Remember this device" for TOTP MFA (authController.js verifyMfa /
-- loginPractitioner, utils/trustedDevices.js). The client keeps a random
-- 32-byte token; only its SHA-256 hex is stored here. A row is honoured at
-- login only for its own practitioner, while revoked_at IS NULL and
-- expires_at > now() (TRUSTED_DEVICE_DAYS, default 30). Every password
-- change/reset, MFA disable, authenticator replacement, admin MFA reset and
-- deactivation revokes all of a practitioner's rows.
-- gen_random_uuid() is built in (PG13+), same as tenant schema.sql uses.

CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id integer NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mfa_trusted_devices_practitioner_id
  ON mfa_trusted_devices (practitioner_id);
