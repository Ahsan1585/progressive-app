import * as React from "react";
import { ShieldAlert } from "lucide-react";
import api from "@/api/axiosInstance";

interface CompanyStatusResponse {
  displayName: string;
  status: string;
  trialEndsAt: string | null;
  baaAccepted: boolean;
}

// Mirrors the web app's BaaGate.jsx — a hard, full-screen block matching the
// backend's own enforcement (authMiddleware.js's `protect` 403s every
// PHI-touching route with `code: 'BAA_REQUIRED'` while a company has no
// accepted Business Associate Agreement on file). Practitioners can never
// accept it themselves (only a ceo can, via the web admin dashboard), so
// this is always just the "contact your admin" message, never a form.
export function BaaGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<"loading" | "blocked" | "ok">("loading");

  React.useEffect(() => {
    api
      .get<CompanyStatusResponse>("/api/auth/company-status")
      .then(({ data }) => setStatus(data.baaAccepted ? "ok" : "blocked"))
      .catch(() => setStatus("ok")); // fail open on a transient error — the backend still enforces the real gate on every actual request
  }, []);

  if (status === "loading") {
    return <div className="flex h-dvh items-center justify-center bg-surface" />;
  }

  if (status === "blocked") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-control bg-danger-bg text-danger">
          <ShieldAlert className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-[17px] font-semibold text-ink">Agreement required</h1>
        <p className="max-w-xs text-sm text-ink-muted">
          Your administrator needs to accept Izaya's Business Associate Agreement before you can continue. Please contact them.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
