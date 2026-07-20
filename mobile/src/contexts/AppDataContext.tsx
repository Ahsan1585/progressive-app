import * as React from "react";
import api from "@/api/axiosInstance";
import type { Patient, PractitionerProfile, PractitionerStats, RejectedLog } from "@/types";

interface AppDataContextValue {
  patients: Patient[];
  patientsLoading: boolean;
  patientsError: string | null;
  fetchPatients: () => Promise<void>;

  profile: PractitionerProfile | null;
  profileLoading: boolean;
  profileError: string | null;
  fetchProfile: () => Promise<void>;

  rejectedLogs: RejectedLog[];
  rejectedLoading: boolean;
  rejectedError: string | null;
  fetchRejectedLogs: () => Promise<void>;

  stats: PractitionerStats | null;
  statsLoading: boolean;
  statsError: string | null;
  fetchStats: () => Promise<void>;

  setSavedSignature: (base64: string | null) => void;
}

const AppDataContext = React.createContext<AppDataContextValue | undefined>(undefined);

// Centralizes the practitioner-scoped fetches shared across Home, Roster,
// Inbox, and Patient Detail — mirrors frontend/src/pages/dashboard.jsx's
// fetch* functions and exact endpoints/field names.
export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [patients, setPatients] = React.useState<Patient[]>([]);
  const [patientsLoading, setPatientsLoading] = React.useState(true);
  const [patientsError, setPatientsError] = React.useState<string | null>(null);

  const [profile, setProfile] = React.useState<PractitionerProfile | null>(null);
  const [profileLoading, setProfileLoading] = React.useState(true);
  const [profileError, setProfileError] = React.useState<string | null>(null);

  const [rejectedLogs, setRejectedLogs] = React.useState<RejectedLog[]>([]);
  const [rejectedLoading, setRejectedLoading] = React.useState(true);
  const [rejectedError, setRejectedError] = React.useState<string | null>(null);

  const [stats, setStats] = React.useState<PractitionerStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(true);
  const [statsError, setStatsError] = React.useState<string | null>(null);

  const fetchPatients = React.useCallback(async () => {
    setPatientsLoading(true);
    setPatientsError(null);
    try {
      const res = await api.get<Patient[]>("/api/patients");
      // The API returns `id` as a JSON number (Postgres integer column), but
      // every consumer compares it against route params (always strings, via
      // useParams) — normalize to string here, once, to match the declared
      // Patient.id: string type and make every `p.id === paramId` lookup work.
      setPatients(res.data.map((p) => ({ ...p, id: String(p.id) })));
    } catch {
      setPatientsError("Couldn't load your patient roster.");
    } finally {
      setPatientsLoading(false);
    }
  }, []);

  const fetchProfile = React.useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await api.get<PractitionerProfile>("/api/practitioner/profile");
      setProfile(res.data);
    } catch {
      setProfileError("Couldn't load your profile.");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const fetchRejectedLogs = React.useCallback(async () => {
    setRejectedLoading(true);
    setRejectedError(null);
    try {
      const res = await api.get<{ success: boolean; logs: RejectedLog[] }>("/api/patients/rejected-logs");
      setRejectedLogs(res.data.logs || []);
    } catch {
      setRejectedError("Couldn't load your rejected/returned logs.");
    } finally {
      setRejectedLoading(false);
    }
  }, []);

  const fetchStats = React.useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await api.get<PractitionerStats>("/api/patients/practitioner-stats");
      setStats(res.data);
    } catch {
      setStatsError("Couldn't load your stats.");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchPatients();
    fetchProfile();
    fetchRejectedLogs();
    fetchStats();
  }, [fetchPatients, fetchProfile, fetchRejectedLogs, fetchStats]);

  const setSavedSignature = React.useCallback((base64: string | null) => {
    setProfile((prev) => (prev ? { ...prev, signature: base64, saved_signature: base64 } : prev));
  }, []);

  const value = React.useMemo<AppDataContextValue>(
    () => ({
      patients,
      patientsLoading,
      patientsError,
      fetchPatients,
      profile,
      profileLoading,
      profileError,
      fetchProfile,
      rejectedLogs,
      rejectedLoading,
      rejectedError,
      fetchRejectedLogs,
      stats,
      statsLoading,
      statsError,
      fetchStats,
      setSavedSignature,
    }),
    [
      patients,
      patientsLoading,
      patientsError,
      fetchPatients,
      profile,
      profileLoading,
      profileError,
      fetchProfile,
      rejectedLogs,
      rejectedLoading,
      rejectedError,
      fetchRejectedLogs,
      stats,
      statsLoading,
      statsError,
      fetchStats,
      setSavedSignature,
    ]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const ctx = React.useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within an AppDataProvider");
  return ctx;
}
