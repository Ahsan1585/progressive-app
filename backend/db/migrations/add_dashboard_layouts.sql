-- One row per office-staff viewer's saved Overview-dashboard section
-- order. FK is to practitioners(id) because that's this app's single
-- logins table for every role, but only office-staff logins (gated by
-- dashboardGuard's master_reports permission check) ever read/write this
-- table — never a clinical practitioner's own login.
-- Idempotent (IF NOT EXISTS) and FK cascades on delete — same conventions
-- every other migration in this directory follows, so this one is safe to
-- re-run on every boot (runMigrations.js) and apply once at signup
-- (signupController.js) without crashing an already-migrated tenant, and
-- deleting a practitioner who saved a layout doesn't leave an orphaned FK
-- error blocking that delete.
CREATE TABLE IF NOT EXISTS dashboard_layouts (
  practitioner_id integer PRIMARY KEY REFERENCES practitioners(id) ON DELETE CASCADE,
  section_order jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
