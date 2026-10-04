// Shapes mirror the existing backend's actual responses exactly
// (backend/src/controllers/*.js, backend/index.js) — no invented fields.

export type Role = "practitioner" | "ceo" | "billing" | "staff_director" | "independent_practitioner";

export interface AuthPractitioner {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  token: string;
  practitioner: AuthPractitioner;
  requirePasswordChange: boolean;
}

export interface Patient {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  dob: string;
  county: string;
  child_id: string;
  practitioner_id: string;
  status?: "active" | "inactive";
  last_service_date?: string | null;
  parent_name?: string | null;
  parent_email?: string | null;
  /** Independent-practitioner-only — superseded by the agency roster (see
   *  GET /api/patients/:id/agencies) but kept for older records. Never
   *  authoritative for SEVF grouping (each assessment's own
   *  company_affiliation is). */
  last_company_affiliation?: string | null;
}

// Independent-practitioner-only (see agencyController.js) — a practitioner-
// owned agency they bill to. A patient's "roster" (GET/PUT
// /api/patients/:id/agencies) is 0..N of these; a session log still picks
// exactly one per log (assessments.company_affiliation stays a plain
// string, matched by name — see resolveAgencyEmail on the backend).
export interface Agency {
  id: number;
  name: string;
  email: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Message {
  id: string;
  practitioner_id: string;
  sender_id: string;
  sender_role: Role;
  body: string;
  created_at: string;
}

export interface ScheduledSession {
  id: string;
  patient_id: string;
  practitioner_id: string;
  patient_first_name?: string;
  patient_last_name?: string;
  session_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  notes: string | null;
  status: "scheduled" | "cancelled";
  parent_notified_at: string | null;
}

export interface DropdownOption {
  id: number;
  // A plain string, not a fixed union — a category key can now be any
  // company-defined custom category's key, not just the 4 built-ins.
  category: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  /** True only for the original seeded/default rows (EV, AS, IFSP, ...) —
   *  these can be deactivated but never permanently deleted. A
   *  practitioner-added option has this false and can be hard-deleted via
   *  DELETE /api/dropdown-options/:id/permanent once unused. */
  is_seeded: boolean;
}

export interface DropdownOptionsByCategory {
  service_type: DropdownOption[];
  service_status: DropdownOption[];
  location: DropdownOption[];
  group_size: DropdownOption[];
  // Any custom category's key also resolves here.
  [key: string]: DropdownOption[];
}

export interface DropdownCategory {
  id: string;
  key: string;
  display_name: string;
  is_custom: boolean;
  is_required_on_log: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface Invoice {
  id: string;
  start_date: string;
  end_date: string;
  paid: boolean;
  paid_at: string | null;
}

// Independent-practitioner-only SEVF self-certification (see
// GET/POST /api/billing/independent/* in billingController.js). A single
// generate request can legitimately produce several separate SEVFs — one
// per (patient, company affiliation, calendar month) group.
export interface SelfCertifiedSevfGroup {
  key: string;
  patientId: number;
  patientName: string;
  companyAffiliation: string | null;
  month: string; // 'YYYY-MM'
  sessionCount: number;
}

// One individual eligible session, as returned alongside SelfCertifiedSevfGroup
// by GET /api/billing/independent/pending — lets the mobile Generate SEVF
// screen show a checkbox per session (plus "Select all") instead of only
// ever generating every session matching the current filters.
export interface SelfCertifiedSession {
  id: number;
  /** Same 3-part key SelfCertifiedSevfGroup.key uses — (patientId, companyAffiliation, month) — for grouping selected sessions client-side. */
  groupKey: string;
  patientId: number;
  patientName: string;
  companyAffiliation: string | null;
  serviceDate: string;
  totalTime: number | null;
}

export interface GeneratedSevfResult {
  batchId: string;
  patientId: number;
  patientName: string;
  companyAffiliation: string | null;
  month: string;
  downloadUrl: string | null;
  /** Absent on a batch generated before invoices existed on this flow. */
  invoiceDownloadUrl?: string | null;
  /** Only present on GET /api/billing/independent/history rows, not on a
   *  just-generated result from POST .../generate-sevf. */
  generatedAt?: string;
  /** Pre-fills "Email to Agency" — null when no saved Agency matches this
   *  batch's companyAffiliation by name, or that agency has no email on
   *  file (see resolveAgencyEmail in agencyController.js). */
  agencyEmail?: string | null;
}

// GET /api/subscription/summary's shape for an independent practitioner's
// account (computeFlatRatePeriodSummary) — a flat monthly price, not the
// per-seat breakdown a tenant company's summary carries.
export interface FlatSubscriptionSummary {
  periodStart: string;
  periodEnd: string;
  nextBillingDate: string;
  flatPrice: number;
  totalAmount: number;
}

export interface SubscriptionPaymentMethod {
  type: string;
  brand: string | null;
  last4: string | null;
  exp: string | null;
}

export type BillingStatus =
  | "pending"
  | "njeis_review"
  | "invoiced"
  | "rejected"
  | "declined"
  /** Independent-practitioner-only equivalent of "pending" — see docs on
   *  the independent-practitioner feature. */
  | "self_certified"
  /** Independent-practitioner-only — set the moment a SEVF/invoice is
   *  generated for this log. */
  | "completed"
  /** Independent-practitioner-only — a "completed" log the practitioner
   *  later flagged as a mistake via Reject. Excluded from hour/revenue
   *  totals going forward; the already-generated SEVF/invoice is untouched. */
  | "voided";

export interface Assessment {
  id: string;
  patient_id: string;
  practitioner_id: string;
  patient_first_name?: string;
  patient_last_name?: string;
  patient_dob?: string;
  patient_county?: string;
  practitioner_first_name?: string;
  practitioner_last_name?: string;
  practitioner_discipline?: string;
  service_date: string;
  start_time: string;
  end_time: string;
  total_time: number;
  status: string;
  type: string;
  location: string;
  group_size_category?: string | null;
  form_data?: { custom_fields?: Record<string, string> } | null;
  billing_status: BillingStatus;
  rejection_note?: string | null;
  rejected_at?: string | null;
  rejection_count?: number;
  parent_signature?: string | null;
  practitioner_signature?: string | null;
  acknowledged_at?: string | null;
  practitioner_response?: string | null;
  /** Independent-practitioner-only — which agency this session is billed
   *  to. Always null for a normal tenant practitioner's logs. */
  company_affiliation?: string | null;
}

export interface RejectedLog {
  id: string;
  patient_first_name: string;
  patient_last_name: string;
  patient_id: string;
  service_date: string;
  type: string;
  location: string;
  start_time: string;
  end_time: string;
  total_time: number;
  status: string;
  group_size_category: string | null;
  form_data?: { custom_fields?: Record<string, string> } | null;
  rejection_note: string | null;
  rejected_at: string | null;
  rejection_count: number;
  parent_signature: string | null;
  billing_status: "rejected" | "declined";
  acknowledged_at: string | null;
}

// A telepractice session awaiting (or having just received) the parent's
// remote signature — matches telepracticeSignatureController.js's
// listTelepracticeRequests response. 'awaiting_signature' items are
// visible-but-not-yet-actionable (shown on Patient Detail, not badge-
// counted); 'signed' items are the practitioner's actual Inbox action item
// ("Ready to submit" — Confirm & Submit creates the real assessment).
export interface TelepracticeSignatureRequest {
  id: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  service_date: string;
  type: string;
  status: "awaiting_signature" | "signed";
  parent_email: string;
  sent_at: string;
  resent_at: string | null;
  resend_count: number;
  signed_at: string | null;
  token_expires: string;
}

// Full detail for one request, fetched on the Confirm & Submit screen —
// matches getTelepracticeRequestDetail's response (the raw
// telepractice_signature_requests row).
export interface TelepracticeSignatureRequestDetail extends TelepracticeSignatureRequest {
  patient_dob: string | null;
  patient_county: string | null;
  practitioner_first_name: string;
  practitioner_last_name: string;
  practitioner_discipline: string | null;
  start_time: string | null;
  end_time: string | null;
  total_time: number | null;
  // Attendance status (e.g. "completed") — named session_status, distinct
  // from this same row's own `status` field (the awaiting_signature/signed
  // lifecycle above), matching the session_status column name in the
  // backend table (renamed there specifically to avoid colliding with the
  // lifecycle `status` column in the same table).
  session_status: string;
  location: string;
  group_size_category: string | null;
  form_data?: { custom_fields?: Record<string, string> } | null;
  note: string | null;
  practitioner_signature: string;
  parent_signature: string | null;
}

// Summary shape for the Home screen's draft list — matches
// sessionDraftsController.js's listDrafts response. A child can have up to
// 2 drafts (see MAX_DRAFTS_PER_PATIENT), so patient_id is NOT unique here —
// `id` is the actual draft identity.
export interface SessionDraftSummary {
  id: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  updated_at: string;
}

// Lightweight shape for one child's own draft list (PatientDetail's "Resume
// draft" section) — matches listDraftsForPatient's response.
export interface SessionDraftListItem {
  id: string;
  updated_at: string;
}

// Full draft shape for pre-filling LogIntervention — matches
// sessionDraftsController.js's getDraft response. form_data mirrors
// LogIntervention's FormState exactly, but kept loosely typed here since a
// draft can be partially filled (any field may be missing).
export interface SessionDraft {
  formData: Record<string, unknown>;
  parentSignatureBase64: string | null;
  practitionerSignatureBase64: string | null;
  updatedAt: string;
}

export interface PractitionerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  position_title?: string | null;
  address?: string | null;
  phone_number?: string | null;
  service_types?: string[] | null;
  /** Only populated for role='independent_practitioner' (see
   *  GET /api/practitioner/profile) — a normal tenant practitioner's own
   *  rate is office-set and deliberately excluded from this response. */
  pay_rate?: number | null;
  /** Independent-practitioner-only — company_settings.legal_entity_name
   *  (see PATCH /api/practitioner/business-entity). null/"" means they
   *  operate as an individual, not through a registered business entity. */
  legal_entity_name?: string | null;
  saved_signature?: string | null;
  // Mapped by the backend from saved_signature for convenience.
  signature?: string | null;
  profile_picture?: string | null;
  // Set while a self-submitted address/phone change is awaiting admin review
  // in the Staff Directory — practitioners.address/phone_number stay
  // unchanged (and are what's shown above) until it's accepted.
  pending_address?: string | null;
  pending_phone_number?: string | null;
  pending_submitted_at?: string | null;
}

export interface PractitionerStats {
  success: boolean;
  logsThisMonth: number;
  hoursThisMonth: number;
  pendingReviewCount: number;
}

// Independent-practitioner-only (see practitionerDashboardController.js) —
// business-dashboard data for Home's dollar-value summary/trend.
export interface PractitionerDashboardSummary {
  sessionsSubmittedThisMonth: number;
  hoursThisMonth: number;
  invoicedThisMonth: number;
  pendingValue: number;
  /** null when last month had $0 invoiced — no meaningful baseline to show a % against. */
  percentChangeVsLastMonth: number | null;
}

export interface MonthlyTrendPoint {
  month: string; // 'YYYY-MM'
  label: string; // e.g. "Jun"
  hours: number;
  invoicedValue: number;
}

export interface AgencyBreakdownEntry {
  name: string;
  hours: number;
  invoicedValue: number;
}

// Independent-practitioner-only — all-time (not month-scoped) pending-SEVF
// breakdown per agency, from GET /api/practitioner-dashboard/by-agency's
// `pending` field. Same scope as PractitionerDashboardSummary.pendingValue
// (every still-self_certified session, any service_date), kept as a
// separate shape from AgencyBreakdownEntry so a pending dollar figure can
// never be mistaken for money already invoiced.
export interface AgencyPendingEntry {
  name: string;
  hours: number;
  pendingValue: number;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
}
