-- backend/db/migrations/drop_group_size_category_check.sql
--
-- assessments.group_size_category still had a hardcoded CHECK limiting it
-- to 'individual'/'consultation', left over from before add_dropdown_categories.sql
-- made the 4 base dropdown categories (including group_size) admin-configurable.
-- A company can now add its own group_size codes via the dropdown-options
-- endpoint, so a literal 2-value CHECK on this column is stale — mirrors the
-- same fix already applied to dropdown_options.category in
-- add_dropdown_categories.sql.
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/drop_group_size_category_check.sql

ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_group_size_category_check;
