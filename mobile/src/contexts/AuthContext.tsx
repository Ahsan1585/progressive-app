import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthPractitioner, LoginResponse } from "@/types";

const TOKEN_KEY = "token";
const ROLE_KEY = "role";
const PRACTITIONER_KEY = "practitioner";

export type LogoutReason = "manual" | "idle" | "session-expired" | "unsupported-role";

interface AuthContextValue {
  token: string | null;
  practitioner: AuthPractitioner | null;
  requirePasswordChange: boolean;
  isPractitioner: boolean;
  /** Set once, non-null, after a logout so Login can show a one-time disclosure banner. */
  logoutBanner: LogoutReason | null;
  clearLogoutBanner: () => void;
  login: (response: LoginResponse) => void;
  completePasswordChange: () => void;
  logout: (reason?: LogoutReason) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredPractitioner(): AuthPractitioner | null {
  try {
    const raw = localStorage.getItem(PRACTITIONER_KEY);
    return raw ? (JSON.parse(raw) as AuthPractitioner) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [practitioner, setPractitioner] = useState<AuthPractitioner | null>(readStoredPractitioner);
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);
  const [logoutBanner, setLogoutBanner] = useState<LogoutReason | null>(null);

  const logout = useCallback((reason: LogoutReason = "manual") => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(PRACTITIONER_KEY);
    setToken(null);
    setPractitioner(null);
    setRequirePasswordChange(false);
    if (reason === "idle" || reason === "session-expired") {
      setLogoutBanner(reason);
    }
  }, []);

  // Any 401 from the API client (expired/invalid JWT) drops the session.
  useEffect(() => {
    const handler = () => logout("session-expired");
    window.addEventListener("mobile-app:session-expired", handler);
    return () => window.removeEventListener("mobile-app:session-expired", handler);
  }, [logout]);

  const login = useCallback((response: LoginResponse) => {
    localStorage.setItem(TOKEN_KEY, response.token);
    localStorage.setItem(ROLE_KEY, response.practitioner.role);
    localStorage.setItem(PRACTITIONER_KEY, JSON.stringify(response.practitioner));
    setToken(response.token);
    setPractitioner(response.practitioner);
    setRequirePasswordChange(response.requirePasswordChange);
  }, []);

  const completePasswordChange = useCallback(() => {
    setRequirePasswordChange(false);
  }, []);

  const clearLogoutBanner = useCallback(() => setLogoutBanner(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      practitioner,
      requirePasswordChange,
      isPractitioner: practitioner?.role === "practitioner",
      logoutBanner,
      clearLogoutBanner,
      login,
      completePasswordChange,
      logout,
    }),
    [token, practitioner, requirePasswordChange, logoutBanner, clearLogoutBanner, login, completePasswordChange, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
