-- One row per office-staff viewer's saved Overview-dashboard section
-- order. FK is to practitioners(id) because that's this app's single
-- logins table for every role, but only office-staff logins (gated by
-- dashboardGuard's master_reports permission check) ever read/write this
-- table — never a clinical practitioner's own login.
CREATE TABLE dashboard_layouts (
  practitioner_id integer PRIMARY KEY REFERENCES practitioners(id),
  section_order jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
