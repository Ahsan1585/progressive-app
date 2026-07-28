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
  { code: "1", label: "Direct Child Service (1)" },
  { code: "2", label: "Practitioner Cancelled - inc weather related (2)" },
  { code: "3", label: "Family Cancelled - inc weather related (3)" },
  { code: "4", label: "Make Up Direct Child Service (4)" },
  { code: "5", label: "Family Missed - within 3 hours (5)" },
  { code: "IFSP", label: "Team Mtg – IFSP" },
  { code: "TPC", label: "Transition Planning Conference" },
  { code: "IT", label: "Bilingual Interpretation" },
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

// Labels match the state's own "Group Size" export column text verbatim
// (minus our parenthetical code suffix) so Compliance Analysis can compare
// them directly, no fuzzy mapping needed.
export const GROUP_SIZE_OPTIONS: { code: string; label: string }[] = [
  { code: "individual", label: "Direct Child Service - Individual" },
  { code: "consultation", label: "Consultation/Facilitation with Others" },
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
