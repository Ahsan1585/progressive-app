-- backend/db/migrations/add_confidentiality_official.sql
-- Designated Confidentiality Official (34 CFR 303.404/303.406). Idempotent.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS confidentiality_official_name text;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS confidentiality_official_title text;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS confidentiality_official_email text;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS confidentiality_official_phone text;
