-- Splits practitioners.address (one free-text field) into structured parts
-- so state/zip are guaranteed-present, independently queryable data instead
-- of whatever a practitioner happened to type into a single string. Driven
-- by the independent-practitioner signup wizard's new Google Places
-- Autocomplete field (IndependentSignupWizard.jsx), which fills all four
-- parts from one selected suggestion — but these columns are on the
-- base `practitioners` table, so any future address-entry UI (tenant staff
-- directory, EditWorkDetails.tsx, etc.) can adopt the same structured shape.
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
