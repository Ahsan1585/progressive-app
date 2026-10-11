-- One-time retroactive price drop: $30 -> $19.99/month for every existing
-- independent practitioner, effective their next billing cycle (does not
-- touch already-issued subscription_invoices rows, which keep their
-- original historical amount for audit purposes). This file is NOT run
-- through the per-tenant migration runner (backend/db/migrations/index.js)
-- since company_settings is per-tenant and there is no existing mechanism
-- there for "run once across every tenant" — it is applied by hand, once,
-- per environment (see Task 1 Step 8 for the runner script).
UPDATE company_settings
SET subscription_flat_price = 19.99
WHERE id = 1 AND subscription_flat_price = 30.00;
