// Shapes mirror the existing backend's actual responses exactly
// (backend/src/controllers/*.js, backend/index.js) — no invented fields.

export type Role = "practitioner" | "ceo" | "billing" | "staff_director";

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

export type BillingStatus =
  | "pending"
  | "njeis_review"
  | "invoiced"
  | "rejected"
  | "declined";

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
  billing_status: BillingStatus;
  rejection_note?: string | null;
  rejected_at?: string | null;
  rejection_count?: number;
  parent_signature?: string | null;
  practitioner_signature?: string | null;
  acknowledged_at?: string | null;
  practitioner_response?: string | null;
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
  rejection_note: string | null;
  rejected_at: string | null;
  rejection_count: number;
  parent_signature: string | null;
  billing_status: "rejected" | "declined";
  acknowledged_at: string | null;
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

export interface ApiErrorBody {
  error?: string;
  message?: string;
}
