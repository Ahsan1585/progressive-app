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
  saved_signature?: string | null;
  // Mapped by the backend from saved_signature for convenience.
  signature?: string | null;
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
