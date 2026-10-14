// backend/src/constants/permissions.js
//
// The fixed 14-key permission catalog for Phase 2's role system. Adding a
// new permission key requires updating this list AND adding a matching
// requirePermission(...) call at whatever route it's meant to guard —
// neither alone is sufficient.
const PERMISSION_KEYS = [
  'staff_directory_view',
  'staff_directory_edit',
  // Deliberately separate from staff_directory_edit_role: that key also
  // grants changing an office-staff member's role (including promoting to
  // Admin) and deactivating/reactivating them, which a role scoped to just
  // "manage practitioners" (e.g. Program Coordinator) shouldn't get for
  // free. Checked in authController.js's deleteStaffMember/
  // reactivateStaffMember for a target whose role is 'practitioner'.
  'staff_directory_edit_role',
  'practitioner_manage',
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
  // Reviewing/deciding a parent's correction request (correction_requests
  // table) and exporting a child's full record — both IDEA Part C/FERPA
  // parent-rights actions (34 CFR 303.405/.410-413), kept as one key since
  // they're both "handle a parent's record-rights request" actions a CEO
  // would delegate to the same staff role.
  'patient_record_rights',
];

// The 4 prebuilt, freely-editable role labels seeded for every tenant
// (in addition to the fixed, non-editable 'Admin' role). Both a brand-new
// tenant's signup provisioning (signupController.js) and the historical
// migration backfill (add_roles_permissions.sql) rely on these exact names.
const PREBUILT_ROLE_NAMES = ['Account Specialist', 'Billing Specialist', 'Program Coordinator', 'Staff Director'];

module.exports = { PERMISSION_KEYS, PREBUILT_ROLE_NAMES };
