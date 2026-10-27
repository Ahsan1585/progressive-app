-- backend/db/migrations/add_statement_of_disagreement.sql
--
-- Adds the parent/guardian's "Statement of Disagreement" right that follows
-- a denied correction request (34 CFR 303.412-413, modeled on FERPA's own
-- 34 CFR 99.21): once a correction request is denied, the parent may place
-- a short written statement of disagreement into the record, and that
-- statement must accompany any future disclosure of the disputed part of
-- the record to anyone else. This column holds that statement;
-- patientRecordExportController.js's buildFullRecordPdf renders it on
-- every export (full and consent-scoped) alongside the existing
-- redisclosure notice, so it travels automatically with every disclosure.
--
-- One statement per correction request (parents who want to add more can
-- have staff log a new correction request referencing the same session —
-- consistent with this table already being an append-mostly history rather
-- than a single mutable row per child).
--
-- Runs against each tenant's own database. Applied idempotently to every
-- tenant on every boot via runMigrations.js (see db/migrations/index.js),
-- so this file must stay safe to re-run.
--
-- Apply with: psql "<tenant connection string>" -f backend/db/migrations/add_statement_of_disagreement.sql

ALTER TABLE correction_requests
  ADD COLUMN IF NOT EXISTS statement_of_disagreement text;

ALTER TABLE correction_requests
  ADD COLUMN IF NOT EXISTS statement_recorded_at timestamptz;

ALTER TABLE correction_requests
  ADD COLUMN IF NOT EXISTS statement_recorded_by integer REFERENCES practitioners(id);
