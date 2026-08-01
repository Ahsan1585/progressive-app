-- backend/db/migrations/add_roles_permissions.sql
--
-- Phase 2: replaces the 3 fine-grained hardcoded office-staff role strings
-- (staff_director/billing/account_specialist) with per-tenant, admin-editable
-- named roles + a granular permission checklist. 'ceo' and 'practitioner'
-- keep their existing meaning and are untouched by this migration.
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_roles_permissions.sql

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id);

-- Seed the fixed Admin role (is_system = true; "all permissions" comes from
-- the is_system flag at query time, not enumeration in role_permissions).
INSERT INTO roles (name, is_system)
  SELECT 'Admin', true
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE is_system = true);

-- Seed the 4 prebuilt labels with the true minimal default (staff_directory_view
-- only). For a brand-new tenant this is exactly what they should start with.
-- For an existing tenant with real staff already assigned to the 3 retired
-- role strings, the backfill block below OVERWRITES these to the
-- behavior-preserving set instead, so no double-seeding conflict occurs.
INSERT INTO roles (name)
  SELECT v.name FROM (VALUES ('Account Specialist'), ('Billing Specialist'), ('Program Coordinator'), ('Staff Director')) AS v(name)
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE roles.name = v.name);

INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, 'staff_directory_view' FROM roles r
  WHERE r.name IN ('Account Specialist', 'Billing Specialist', 'Program Coordinator', 'Staff Director')
  ON CONFLICT DO NOTHING;

-- Behavior-preserving backfill for an existing tenant's real staff: only
-- runs meaningfully if practitioners.role currently holds one of the 3
-- retired values (a brand-new tenant has none, so this is a no-op there).
-- Overwrite 'Staff Director' role's permissions to match today's
-- staff_director requireRole guards exactly.
DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'Staff Director')
  AND EXISTS (SELECT 1 FROM practitioners WHERE role = 'staff_director');
INSERT INTO role_permissions (role_id, permission_key)
  SELECT (SELECT id FROM roles WHERE name = 'Staff Director'), key
  FROM unnest(ARRAY['staff_directory_view', 'staff_directory_edit', 'staff_directory_edit_role', 'register_new_user']) AS key
  WHERE EXISTS (SELECT 1 FROM practitioners WHERE role = 'staff_director')
  ON CONFLICT DO NOTHING;

-- Overwrite 'Billing Specialist' role's permissions to match today's
-- 'billing' requireRole guards exactly.
DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'Billing Specialist')
  AND EXISTS (SELECT 1 FROM practitioners WHERE role = 'billing');
INSERT INTO role_permissions (role_id, permission_key)
  SELECT (SELECT id FROM roles WHERE name = 'Billing Specialist'), key
  FROM unnest(ARRAY['billing_pending', 'billing_completed', 'billing_invoice_status']) AS key
  WHERE EXISTS (SELECT 1 FROM practitioners WHERE role = 'billing')
  ON CONFLICT DO NOTHING;

-- Overwrite 'Account Specialist' role's permissions to match today's
-- 'account_specialist' requireRole guards exactly.
DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'Account Specialist')
  AND EXISTS (SELECT 1 FROM practitioners WHERE role = 'account_specialist');
INSERT INTO role_permissions (role_id, permission_key)
  SELECT (SELECT id FROM roles WHERE name = 'Account Specialist'), key
  FROM unnest(ARRAY['staff_directory_view', 'staff_directory_edit', 'register_new_user', 'billing_pending', 'billing_completed', 'billing_invoice_status']) AS key
  WHERE EXISTS (SELECT 1 FROM practitioners WHERE role = 'account_specialist')
  ON CONFLICT DO NOTHING;

-- Point every existing practitioner row at its matching seeded role.
UPDATE practitioners SET role_id = (SELECT id FROM roles WHERE name = 'Admin') WHERE role = 'ceo' AND role_id IS NULL;
UPDATE practitioners SET role_id = (SELECT id FROM roles WHERE name = 'Staff Director') WHERE role = 'staff_director' AND role_id IS NULL;
UPDATE practitioners SET role_id = (SELECT id FROM roles WHERE name = 'Billing Specialist') WHERE role = 'billing' AND role_id IS NULL;
UPDATE practitioners SET role_id = (SELECT id FROM roles WHERE name = 'Account Specialist') WHERE role = 'account_specialist' AND role_id IS NULL;

-- Finally, collapse the 3 retired literal values down to the 'staff'
-- catch-all now that role_id carries the real distinction.
UPDATE practitioners SET role = 'staff' WHERE role IN ('staff_director', 'billing', 'account_specialist');

-- Tighten the legacy role check: the 3 fine-grained strings have collapsed into
-- one 'staff' catch-all; 'ceo' and 'practitioner' are unchanged. This constraint
-- is applied AFTER the role collapse so it does not reject existing 'staff_director',
-- 'billing', and 'account_specialist' rows.
ALTER TABLE practitioners DROP CONSTRAINT IF EXISTS practitioners_role_check;
ALTER TABLE practitioners ADD CONSTRAINT practitioners_role_check
  CHECK (role = ANY (ARRAY['practitioner'::text, 'ceo'::text, 'staff'::text]));
