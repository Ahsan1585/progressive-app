-- backend/db/migrations/add_dropdown_categories.sql
--
-- Replaces the 4-value hardcoded allowlist gating dropdown_options.category
-- with a real registry table, so a company can define its own additional
-- dropdown categories beyond the 4 built-in, state-mandated ones.
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_dropdown_categories.sql

CREATE TABLE IF NOT EXISTS dropdown_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  display_name text NOT NULL,
  is_custom boolean NOT NULL DEFAULT true,
  is_required_on_log boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dropdown_categories_key_key UNIQUE (key)
);

-- Seed the 4 built-ins, matching their current fixed tab order exactly.
INSERT INTO dropdown_categories (key, display_name, is_custom, sort_order)
  SELECT v.key, v.display_name, false, v.sort_order
  FROM (VALUES
    ('service_type', 'Service Type', 0),
    ('service_status', 'Service Status', 1),
    ('location', 'Location', 2),
    ('group_size', 'Group Size Category', 3)
  ) AS v(key, display_name, sort_order)
  WHERE NOT EXISTS (SELECT 1 FROM dropdown_categories WHERE dropdown_categories.key = v.key);

-- Drop the old hardcoded CHECK — a category is now valid if it exists as a
-- row in dropdown_categories, not if it matches one of 4 literal strings.
ALTER TABLE dropdown_options DROP CONSTRAINT IF EXISTS dropdown_options_category_check;

-- Real referential integrity: every dropdown_options row's category must
-- point at a real dropdown_categories.key. Added AFTER the seed insert
-- above so the 4 built-ins already exist and this doesn't reject any
-- existing dropdown_options row.
ALTER TABLE dropdown_options DROP CONSTRAINT IF EXISTS dropdown_options_category_fkey;
ALTER TABLE dropdown_options ADD CONSTRAINT dropdown_options_category_fkey
  FOREIGN KEY (category) REFERENCES dropdown_categories(key);
