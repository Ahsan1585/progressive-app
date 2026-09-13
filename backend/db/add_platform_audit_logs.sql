-- Platform-level audit trail — platform-admin logins, company creation,
-- and every impersonation session. Nothing like this existed before: the
-- per-tenant audit_logs table (backend/db/schema.sql) requires an active
-- tenant context (runWithTenant) and can't record platform-scoped actions.
-- Manually applied (psql -f) like add_promo_codes.sql / add_platform_admins.sql.
--
-- platform_admin_id is nullable so a failed-login-with-unknown-email can
-- still be logged (with the attempted email captured in `details`).
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id uuid REFERENCES platform_admins(id),
  action text NOT NULL,
  target_company_slug text,
  details jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_logs_created_at_idx ON platform_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_logs_target_company_slug_idx ON platform_audit_logs (target_company_slug);
