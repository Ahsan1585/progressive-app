import * as React from "react";
import api from "@/api/axiosInstance";
import type { Patient, PractitionerProfile, PractitionerStats, RejectedLog, ScheduledSession } from "@/types";

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

  unreadMessageCount: number;
  fetchUnreadMessageCount: () => Promise<void>;

  upcomingSessions: ScheduledSession[];
  upcomingSessionsLoading: boolean;
  fetchUpcomingSessions: () => Promise<void>;

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

  const [unreadMessageCount, setUnreadMessageCount] = React.useState(0);

  const [upcomingSessions, setUpcomingSessions] = React.useState<ScheduledSession[]>([]);
  const [upcomingSessionsLoading, setUpcomingSessionsLoading] = React.useState(true);

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

  const fetchUnreadMessageCount = React.useCallback(async () => {
    try {
      const res = await api.get<{ unreadCount: number }>("/api/messages/unread-count");
      setUnreadMessageCount(res.data.unreadCount || 0);
    } catch {
      // Non-critical for a badge count — leave the previous value in place.
    }
  }, []);

  const fetchUpcomingSessions = React.useCallback(async () => {
    setUpcomingSessionsLoading(true);
    try {
      // Local YYYY-MM-DD (not toISOString, which shifts to UTC and can drop
      // to yesterday's date for practitioners west of UTC in the evening).
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const res = await api.get<ScheduledSession[]>("/api/schedule", { params: { from: today } });
      setUpcomingSessions(res.data.filter((s) => s.status === "scheduled"));
    } catch {
      // Non-critical — the Home schedule section just stays empty.
    } finally {
      setUpcomingSessionsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchPatients();
    fetchProfile();
    fetchRejectedLogs();
    fetchStats();
    fetchUnreadMessageCount();
    fetchUpcomingSessions();
  }, [fetchPatients, fetchProfile, fetchRejectedLogs, fetchStats, fetchUnreadMessageCount, fetchUpcomingSessions]);

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
      unreadMessageCount,
      fetchUnreadMessageCount,
      upcomingSessions,
      upcomingSessionsLoading,
      fetchUpcomingSessions,
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
      unreadMessageCount,
      fetchUnreadMessageCount,
      upcomingSessions,
      upcomingSessionsLoading,
      fetchUpcomingSessions,
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
