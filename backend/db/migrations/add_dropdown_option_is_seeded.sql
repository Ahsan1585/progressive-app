-- backend/db/migrations/add_dropdown_option_is_seeded.sql
--
-- Distinguishes the original seeded dropdown_options rows (EV, AS, IFSP...
-- from add_dropdown_options.sql's seed INSERT) from ones a company/
-- practitioner has added themselves via "Add option" — needed so hard-delete
-- (as opposed to the existing soft-delete/deactivate, which already applied
-- uniformly to every option) can be offered for practitioner-added options
-- without ever risking a seeded, state-mandated code being permanently
-- removed from a tenant's vocabulary.
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_dropdown_option_is_seeded.sql

ALTER TABLE dropdown_options ADD COLUMN IF NOT EXISTS is_seeded boolean NOT NULL DEFAULT false;

-- One-time backfill: mark every row that matches the original seed data
-- (category + code, from add_dropdown_options.sql's INSERT) as seeded.
-- Matches by (category, code) rather than relying on row id/insertion
-- order, since a seeded row could have been re-added via the existing
-- ON CONFLICT...DO UPDATE reactivation path and still be the "same" seed
-- option. Only ever sets is_seeded TRUE here — never clears it — so this
-- migration is safe to re-run (a no-op after the first successful apply).
UPDATE dropdown_options SET is_seeded = true
WHERE (category, code) IN (
  ('service_type', 'EV'), ('service_type', 'AS'), ('service_type', 'IFSP'),
  ('service_type', 'AU'), ('service_type', 'DI'), ('service_type', 'FT'),
  ('service_type', 'HS'), ('service_type', 'MS'), ('service_type', 'NU'),
  ('service_type', 'NT'), ('service_type', 'OT'), ('service_type', 'PT'),
  ('service_type', 'PSY'), ('service_type', 'SLP'), ('service_type', 'SW'),
  ('service_type', 'VI'), ('service_type', 'CC'), ('service_type', 'I/T'),
  ('service_type', 'ES'), ('service_type', 'TPC'),
  ('service_status', '1'), ('service_status', '2'), ('service_status', '3'),
  ('service_status', '4'), ('service_status', '5'), ('service_status', 'IFSP'),
  ('service_status', 'TPC'), ('service_status', 'IT'),
  ('location', '1'), ('location', '2'), ('location', '3'), ('location', '4'),
  ('location', '5'), ('location', '6'), ('location', '7'), ('location', '8'),
  ('group_size', 'individual'), ('group_size', 'consultation')
);
