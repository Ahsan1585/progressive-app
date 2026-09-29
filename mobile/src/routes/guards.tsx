import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Roles this mobile app supports — a normal tenant-company practitioner,
// and an independent practitioner (no tenant company, self-registered
// directly with Izaya). Every other role (ceo/staff/billing/staff_director)
// belongs to the office web dashboard, not this app.
const SUPPORTED_ROLES = ["practitioner", "independent_practitioner"];

// Gates the authenticated shell + all pushed views: must have a token, be a
// supported role, and have already completed any forced password change.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, practitioner, requirePasswordChange } = useAuth();

  if (!token) return <Navigate to="/login" replace />;
  if (practitioner && !SUPPORTED_ROLES.includes(practitioner.role)) return <Navigate to="/unsupported-role" replace />;
  if (requirePasswordChange) return <Navigate to="/change-password" replace />;

  return <>{children}</>;
}

// Gates the Forced Password Change screen itself — only reachable mid-flow.
export function RequireForcedChange({ children }: { children: ReactNode }) {
  const { token, practitioner, requirePasswordChange } = useAuth();

  if (!token) return <Navigate to="/login" replace />;
  if (practitioner && !SUPPORTED_ROLES.includes(practitioner.role)) return <Navigate to="/unsupported-role" replace />;
  if (!requirePasswordChange) return <Navigate to="/home" replace />;

  return <>{children}</>;
}

// Gates the /messages route specifically — an independent practitioner has
// no office to message (their single-seat company has nobody on "the other
// side" of a thread), so a bookmarked/direct URL should bounce to Home
// rather than reaching a thread that can never receive a reply, same as
// the tab bar already omits this tab entirely for this role (TabBar.tsx).
export function RequireOffice({ children }: { children: ReactNode }) {
  const { isIndependentPractitioner } = useAuth();
  if (isIndependentPractitioner) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

// Gates the pre-auth stack — an already-fully-authenticated practitioner is
// bounced straight to Home rather than seeing Login again.
export function RequireGuest({ children }: { children: ReactNode }) {
  const { token, practitioner, requirePasswordChange } = useAuth();

  if (token && practitioner && SUPPORTED_ROLES.includes(practitioner.role) && !requirePasswordChange) {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}
