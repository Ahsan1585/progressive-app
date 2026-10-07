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
  isIndependentPractitioner: boolean;
  /** Set once, non-null, after a logout so Login can show a one-time disclosure banner. */
  logoutBanner: LogoutReason | null;
  clearLogoutBanner: () => void;
  login: (response: LoginResponse) => void;
  completePasswordChange: () => void;
  logout: (reason?: LogoutReason) => void;
  /** Patches the cached practitioner's name in place (state + localStorage)
   *  after a profile edit (Work Details) — nothing else keeps this in sync,
   *  since `practitioner` is only ever set at login time otherwise. Without
   *  this, Home's "Welcome back, <name>" (and anywhere else this cached
   *  object is read) keeps showing the name as of the last login even after
   *  a successful name change elsewhere in the app. */
  updatePractitionerName: (firstName: string, lastName: string) => void;
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

  const updatePractitionerName = useCallback((firstName: string, lastName: string) => {
    setPractitioner((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, firstName, lastName };
      localStorage.setItem(PRACTITIONER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      practitioner,
      requirePasswordChange,
      isPractitioner: practitioner?.role === "practitioner",
      isIndependentPractitioner: practitioner?.role === "independent_practitioner",
      logoutBanner,
      clearLogoutBanner,
      login,
      completePasswordChange,
      logout,
      updatePractitionerName,
    }),
    [
      token,
      practitioner,
      requirePasswordChange,
      logoutBanner,
      clearLogoutBanner,
      login,
      completePasswordChange,
      logout,
      updatePractitionerName,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
