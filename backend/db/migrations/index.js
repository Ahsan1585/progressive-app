// Single source of truth for the ordered, idempotent migration file list —
// imported both by runMigrations.js (applied to every existing tenant on
// every boot) and signupController.js (applied once to a brand-new
// tenant's freshly-created database during provisioning), so the two can
// never drift apart.
const MIGRATIONS = [
  'add_subscription_billing.sql',
  'add_dropdown_options.sql',
  'add_compliance_learning.sql',
  'fix_zero_time_logs.sql',
  'add_eims_missing_approval.sql',
  'add_eims_missing_approval_workflow.sql',
  'add_invoice_overdue_status.sql',
  'add_roles_permissions.sql',
  'add_dropdown_categories.sql',
  'add_patient_practitioners.sql',
];

module.exports = { MIGRATIONS };
