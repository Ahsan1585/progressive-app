// Service Type/Status/Location/Group Size vocabularies are admin-configurable
// now (Company Information > Dropdown Options, web) — see
// AppDataContext.tsx's dropdownOptions/serviceTypeOptions/etc., fetched from
// GET /api/dropdown-options. Only the billing-workflow status config (a
// fixed, non-admin-configurable concept) still lives here.

export interface BillingStatusConfig {
  label: string;
  variant: "info" | "success" | "warning" | "danger" | "neutral";
}

// Text-labeled billing status semantics — never color-only (a11y requirement).
export const billingStatusConfig: Record<string, BillingStatusConfig> = {
  pending: { label: "Pending", variant: "neutral" },
  njeis_review: { label: "In Review", variant: "info" },
  invoiced: { label: "Accepted", variant: "success" },
  rejected: { label: "Returned", variant: "warning" },
  declined: { label: "Declined", variant: "danger" },
  // Independent-practitioner-only (see docs on the independent-practitioner
  // feature) — this role has no office review queue, so these three
  // replace pending/njeis_review/invoiced for their own logs.
  self_certified: { label: "Ready to Generate", variant: "neutral" },
  completed: { label: "SEVF Generated", variant: "success" },
  voided: { label: "Rejected", variant: "danger" },
};
