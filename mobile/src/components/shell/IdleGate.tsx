import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { IdleWarningOverlay } from "@/components/IdleWarningOverlay";

// Mounted only within the authenticated tree — 15-minute idle logout with a
// 13-minute warning (story 9 + design flow 12).
export function IdleGate({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const onExpire = React.useCallback(() => {
    logout("idle");
    navigate("/login", { replace: true });
  }, [logout, navigate]);

  const { phase, secondsUntilLogout, reset } = useIdleTimer({ enabled: true, onExpire });

  return (
    <>
      {children}
      <IdleWarningOverlay open={phase === "warning"} secondsRemaining={secondsUntilLogout} onStayLoggedIn={reset} />
    </>
  );
}
