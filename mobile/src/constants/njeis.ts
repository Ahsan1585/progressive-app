// Fixed NJEIS vocabularies — hard-coded to match
// frontend/src/pages/dashboard.jsx and frontend/src/components/LogInterventionModal.jsx
// exactly. No new codes invented (spec acceptance criterion, story 6).

export const SERVICE_TYPE_OPTIONS: { code: string; label: string }[] = [
  { code: "EV", label: "Evaluation (EV)" },
  { code: "AS", label: "Assessment (AS)" },
  { code: "IFSP", label: "IFSP Meeting" },
  { code: "AU", label: "Audiology (AU)" },
  { code: "DI", label: "Developmental Intervention (DI)" },
  { code: "FT", label: "Family Training (FT)" },
  { code: "HS", label: "Health Service (HS)" },
  { code: "MS", label: "Medical Service (MS)" },
  { code: "NU", label: "Nursing (NU)" },
  { code: "NT", label: "Nutrition (NT)" },
  { code: "OT", label: "Occupational Therapy (OT)" },
  { code: "PT", label: "Physical Therapy (PT)" },
  { code: "PSY", label: "Psychological (PSY)" },
  { code: "SLP", label: "Speech Language Therapy (SLP)" },
  { code: "SW", label: "Social Work (SW)" },
  { code: "VI", label: "Vision (VI)" },
  { code: "CC", label: "Childcare/Respite (CC)" },
  { code: "I/T", label: "Interpreter/Translator (I/T)" },
  { code: "ES", label: "Escort/Security (ES)" },
  { code: "TPC", label: "Transition Planning Conference (TPC)" },
];

export const STATUS_CODE_OPTIONS: { code: string; label: string }[] = [
  { code: "1", label: "Ongoing IFSP Service (1)" },
  { code: "2", label: "Practitioner Missed/Cancelled (2)" },
  { code: "3", label: "Family Missed/Cancelled (3)" },
  { code: "4", label: "Make-up Service Provided (4)" },
  { code: "5", label: "Compensatory Service Provided (5)" },
];

export const LOCATION_CODE_OPTIONS: { code: string; label: string }[] = [
  { code: "1", label: "Home (1)" },
  { code: "2", label: "Residential Facility (2)" },
  { code: "3", label: "Service Provider Clinic/Office (3)" },
  { code: "4", label: "Hospital (Inpatient) (4)" },
  { code: "5", label: "EC Program - Children with Disabilities (5)" },
  { code: "6", label: "EC Program - Inclusive Community (6)" },
  { code: "7", label: "DCP&P Office (7)" },
  { code: "8", label: "Phone/Video Conferencing (8)" },
];

export const serviceTypeMap: Record<string, string> = Object.fromEntries(
  SERVICE_TYPE_OPTIONS.map((o) => [o.code, o.label])
);
export const statusCodeMap: Record<string, string> = Object.fromEntries(
  STATUS_CODE_OPTIONS.map((o) => [o.code, o.label])
);
export const locationCodeMap: Record<string, string> = Object.fromEntries(
  LOCATION_CODE_OPTIONS.map((o) => [o.code, o.label])
);

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
};
