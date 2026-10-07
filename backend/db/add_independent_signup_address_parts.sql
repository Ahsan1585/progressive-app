-- Standalone one-off migration for the existing izaya_platform database —
-- same convention as add_independent_signup_disciplines_dropdowns.sql.
--
-- Carries the structured address parts (see
-- backend/db/migrations/add_practitioner_address_parts.sql, applied to
-- every tenant database) through the pending-confirmation window of
-- independent-practitioner signup, the same way discipline/pay_rate/address
-- already do. Nullable — a tenant-company signup never fills these, and an
-- address typed without using the autocomplete widget falls back to being
-- stored only in the existing single `address` text column.
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS address_city text;
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS address_state text;
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS address_zip text;
