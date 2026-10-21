-- Email-verified MFA self-recovery (authController.js requestMfaResetEmail /
-- confirmMfaReset). After a correct password, a user who has lost both their
-- authenticator and recovery codes can ask for a one-time link to their own
-- address. Only the SHA-256 hex of the random 32-byte token is stored. A row
-- is honoured once (used_at IS NULL, claimed atomically) and only until
-- expires_at (30 minutes). The (practitioner_id, created_at) index backs the
-- 3-per-hour cap. Any password change marks a user's unused rows used.
-- gen_random_uuid() is built in (PG13+), same as tenant schema.sql uses.

CREATE TABLE IF NOT EXISTS mfa_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id integer NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfa_reset_requests_practitioner_created
  ON mfa_reset_requests (practitioner_id, created_at);

-- Set to now() on every password write for an existing account (reset,
-- change, activation). Email MFA reset is refused for 24 hours after it, so
-- someone who only controls the inbox can't chain forgot-password into an
-- MFA reset. NULL = never changed since this column existed (allowed).
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
