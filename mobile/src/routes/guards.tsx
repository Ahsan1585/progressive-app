import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Gates the authenticated shell + all pushed views: must have a token, be a
// practitioner, and have already completed any forced password change.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, practitioner, requirePasswordChange } = useAuth();

  if (!token) return <Navigate to="/login" replace />;
  if (practitioner && practitioner.role !== "practitioner") return <Navigate to="/unsupported-role" replace />;
  if (requirePasswordChange) return <Navigate to="/change-password" replace />;

  return <>{children}</>;
}

// Gates the Forced Password Change screen itself — only reachable mid-flow.
export function RequireForcedChange({ children }: { children: ReactNode }) {
  const { token, practitioner, requirePasswordChange } = useAuth();

  if (!token) return <Navigate to="/login" replace />;
  if (practitioner && practitioner.role !== "practitioner") return <Navigate to="/unsupported-role" replace />;
  if (!requirePasswordChange) return <Navigate to="/home" replace />;

  return <>{children}</>;
}

// Gates the pre-auth stack — an already-fully-authenticated practitioner is
// bounced straight to Home rather than seeing Login again.
export function RequireGuest({ children }: { children: ReactNode }) {
  const { token, practitioner, requirePasswordChange } = useAuth();

  if (token && practitioner?.role === "practitioner" && !requirePasswordChange) {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}
