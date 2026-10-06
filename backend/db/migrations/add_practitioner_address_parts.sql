-- Splits practitioners.address (one free-text field) into structured parts
-- so state/zip are guaranteed-present, independently queryable data instead
-- of whatever a practitioner happened to type into a single string. Driven
-- by the independent-practitioner signup wizard's structured street/city/
-- state/ZIP fields (IndependentSignupWizard.jsx) — these columns live on
-- the base `practitioners` table, so any future address-entry UI (tenant
-- staff directory, EditWorkDetails.tsx, etc.) can adopt the same shape.
--
-- `address` itself is NOT dropped and stays the single source of truth for
-- every existing reader (PDF generation, invoices, Staff Directory table,
-- EditWorkDetails.tsx) — these new columns are populated going forward
-- alongside it, auto-composed into the same string by the writer
-- (independentSignupController.js), not read from it.
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS address_city text;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS address_state text;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS address_zip text;
