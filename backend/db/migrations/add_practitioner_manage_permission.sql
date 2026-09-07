-- backend/db/migrations/add_practitioner_manage_permission.sql
--
-- New 'practitioner_manage' permission key (see backend/src/constants/
-- permissions.js) — deactivate/reactivate a practitioner from the Staff
-- Directory's Practitioners tab, without also granting the broader
-- staff_directory_edit_role power to change an office-staff member's role
-- or deactivate them.
--
-- Grant it by default to the 'Program Coordinator' prebuilt role, on top
-- of whatever permissions that role already has (additive, never
-- overwrites — a tenant may have already customized this role's other
-- permissions via Role Management).
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_practitioner_manage_permission.sql

INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, 'practitioner_manage' FROM roles r
  WHERE r.name = 'Program Coordinator'
  ON CONFLICT DO NOTHING;
