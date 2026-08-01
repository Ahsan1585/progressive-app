// backend/src/constants/permissions.js
//
// The fixed 13-key permission catalog for Phase 2's role system. Adding a
// new permission key requires updating this list AND adding a matching
// requirePermission(...) call at whatever route it's meant to guard —
// neither alone is sufficient.
const PERMISSION_KEYS = [
  'staff_directory_view',
  'staff_directory_edit',
  'staff_directory_edit_role',
  'register_new_user',
  'master_reports',
  'billing_pending',
  'billing_completed',
  'billing_invoice_status',
  'subscription_billing',
  'company_info_compliance_doc',
  'company_info_dropdown_options',
  'audit_logs',
  'action_required_approve',
];

// The 4 prebuilt, freely-editable role labels seeded for every tenant
// (in addition to the fixed, non-editable 'Admin' role). Both a brand-new
// tenant's signup provisioning (signupController.js) and the historical
// migration backfill (add_roles_permissions.sql) rely on these exact names.
const PREBUILT_ROLE_NAMES = ['Account Specialist', 'Billing Specialist', 'Program Coordinator', 'Staff Director'];

module.exports = { PERMISSION_KEYS, PREBUILT_ROLE_NAMES };
