-- Server-side idle timeout: authMiddleware's `protect` rejects a session
-- whose practitioner has had no authenticated request for
-- SESSION_IDLE_MINUTES. NULL means "never seen since this column existed"
-- and is treated as active, so deploying this logs nobody out.
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- TOTP MFA. Secrets are stored encrypted (fieldEncryption.js, v1: format).
-- mfa_pending_secret holds a secret from /mfa/setup until /mfa/enable
-- confirms it with a valid code, so starting setup never disturbs anything.
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS mfa_pending_secret text;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
-- SHA-256 hex of each unused single-use recovery code.
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS mfa_recovery_hashes text[];
-- Last accepted TOTP time step, so the same code can't be replayed.
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS mfa_last_used_step bigint;
-- Per-account brute-force lockout, on top of the per-IP rate limiter.
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS mfa_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS mfa_locked_until timestamptz;

-- Company-wide "everyone must enroll" switch. Default OFF so nobody is
-- forced into enrollment on deploy.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;
