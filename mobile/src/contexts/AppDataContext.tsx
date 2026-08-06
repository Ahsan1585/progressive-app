import * as React from "react";
import api from "@/api/axiosInstance";
import type { DropdownCategory, DropdownOption, DropdownOptionsByCategory, Patient, PractitionerProfile, PractitionerStats, RejectedLog, ScheduledSession, SessionDraftSummary } from "@/types";

const EMPTY_DROPDOWN_OPTIONS: DropdownOptionsByCategory = { service_type: [], service_status: [], location: [], group_size: [] };

const activeOnly = (list: DropdownOption[]) => list.filter((o) => o.is_active);
const buildCodeLabelMap = (list: DropdownOption[]): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const o of list) map[o.code] = o.label;
  return map;
};

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
  fetchRejectedLogs: (opts?: { silent?: boolean }) => Promise<void>;

  drafts: SessionDraftSummary[];
  draftsLoading: boolean;
  fetchDrafts: (opts?: { silent?: boolean }) => Promise<void>;

  stats: PractitionerStats | null;
  statsLoading: boolean;
  statsError: string | null;
  fetchStats: () => Promise<void>;

  unreadMessageCount: number;
  fetchUnreadMessageCount: () => Promise<void>;

  upcomingSessions: ScheduledSession[];
  upcomingSessionsLoading: boolean;
  fetchUpcomingSessions: () => Promise<void>;

  companyName: string | null;
  fetchCompanyBranding: () => Promise<void>;

  // Service Type/Status/Location/Group Size vocabularies are admin-configurable
  // (Company Information > Dropdown Options, web) rather than hardcoded.
  // serviceTypeOptions/etc. are active-only, for populating a Picker; the
  // *Map objects are built from ALL rows (active + inactive), for resolving a
  // code to a label on a historical log even if the option's since been
  // deactivated.
  dropdownOptions: DropdownOptionsByCategory;
  dropdownCategories: DropdownCategory[];
  serviceTypeOptions: DropdownOption[];
  statusOptions: DropdownOption[];
  locationOptions: DropdownOption[];
  groupSizeOptions: DropdownOption[];
  serviceTypeMap: Record<string, string>;
  statusCodeMap: Record<string, string>;
  locationCodeMap: Record<string, string>;
  fetchDropdownOptions: () => Promise<void>;

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

  const [drafts, setDrafts] = React.useState<SessionDraftSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = React.useState(true);

  const [stats, setStats] = React.useState<PractitionerStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(true);
  const [statsError, setStatsError] = React.useState<string | null>(null);

  const [unreadMessageCount, setUnreadMessageCount] = React.useState(0);

  const [upcomingSessions, setUpcomingSessions] = React.useState<ScheduledSession[]>([]);
  const [upcomingSessionsLoading, setUpcomingSessionsLoading] = React.useState(true);

  const [companyName, setCompanyName] = React.useState<string | null>(null);

  const [dropdownOptions, setDropdownOptions] = React.useState<DropdownOptionsByCategory>(EMPTY_DROPDOWN_OPTIONS);
  const [dropdownCategories, setDropdownCategories] = React.useState<DropdownCategory[]>([]);

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

  const fetchRejectedLogs = React.useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setRejectedLoading(true);
    setRejectedError(null);
    try {
      const res = await api.get<{ success: boolean; logs: RejectedLog[] }>("/api/patients/rejected-logs");
      setRejectedLogs(res.data.logs || []);
    } catch {
      if (!silent) setRejectedError("Couldn't load your rejected/returned logs.");
    } finally {
      if (!silent) setRejectedLoading(false);
    }
  }, []);

  const fetchDrafts = React.useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setDraftsLoading(true);
    try {
      const res = await api.get<{ success: boolean; drafts: SessionDraftSummary[] }>("/api/session-drafts");
      setDrafts(res.data.drafts || []);
    } catch {
      // Non-critical — the "Continue where you left off" card just stays empty until retried.
    } finally {
      if (!silent) setDraftsLoading(false);
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

  const fetchCompanyBranding = React.useCallback(async () => {
    try {
      const res = await api.get<{ display_name: string | null }>("/api/company/branding");
      setCompanyName(res.data.display_name || null);
    } catch {
      // Non-critical — the Home header just omits the company name.
    }
  }, []);

  const fetchDropdownOptions = React.useCallback(async () => {
    try {
      const [optionsRes, categoriesRes] = await Promise.all([
        api.get<{ options: DropdownOptionsByCategory }>("/api/dropdown-options"),
        api.get<{ categories: DropdownCategory[] }>("/api/dropdown-options/categories"),
      ]);
      setDropdownOptions(optionsRes.data.options);
      setDropdownCategories(categoriesRes.data.categories);
    } catch {
      // Non-critical enough to fail silently — pickers just render empty until retried.
    }
  }, []);

  React.useEffect(() => {
    fetchPatients();
    fetchProfile();
    fetchRejectedLogs();
    fetchDrafts();
    fetchStats();
    fetchUnreadMessageCount();
    fetchUpcomingSessions();
    fetchCompanyBranding();
    fetchDropdownOptions();
  }, [fetchPatients, fetchProfile, fetchRejectedLogs, fetchDrafts, fetchStats, fetchUnreadMessageCount, fetchUpcomingSessions, fetchCompanyBranding, fetchDropdownOptions]);

  // Keep Inbox live — a log billing just returned should appear without the
  // practitioner having to leave the app and come back. Mirrors the admin
  // portal's 20s silent poll on Pending Bills.
  React.useEffect(() => {
    const interval = setInterval(() => fetchRejectedLogs({ silent: true }), 20000);
    return () => clearInterval(interval);
  }, [fetchRejectedLogs]);

  const setSavedSignature = React.useCallback((base64: string | null) => {
    setProfile((prev) => (prev ? { ...prev, signature: base64, saved_signature: base64 } : prev));
  }, []);

  const serviceTypeOptions = React.useMemo(() => activeOnly(dropdownOptions.service_type), [dropdownOptions]);
  const statusOptions = React.useMemo(() => activeOnly(dropdownOptions.service_status), [dropdownOptions]);
  const locationOptions = React.useMemo(() => activeOnly(dropdownOptions.location), [dropdownOptions]);
  const groupSizeOptions = React.useMemo(() => activeOnly(dropdownOptions.group_size), [dropdownOptions]);
  const serviceTypeMap = React.useMemo(() => buildCodeLabelMap(dropdownOptions.service_type), [dropdownOptions]);
  const statusCodeMap = React.useMemo(() => buildCodeLabelMap(dropdownOptions.service_status), [dropdownOptions]);
  const locationCodeMap = React.useMemo(() => buildCodeLabelMap(dropdownOptions.location), [dropdownOptions]);

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
      drafts,
      draftsLoading,
      fetchDrafts,
      stats,
      statsLoading,
      statsError,
      fetchStats,
      unreadMessageCount,
      fetchUnreadMessageCount,
      upcomingSessions,
      upcomingSessionsLoading,
      fetchUpcomingSessions,
      companyName,
      fetchCompanyBranding,
      dropdownOptions,
      dropdownCategories,
      serviceTypeOptions,
      statusOptions,
      locationOptions,
      groupSizeOptions,
      serviceTypeMap,
      statusCodeMap,
      locationCodeMap,
      fetchDropdownOptions,
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
      drafts,
      draftsLoading,
      fetchDrafts,
      stats,
      statsLoading,
      statsError,
      fetchStats,
      unreadMessageCount,
      fetchUnreadMessageCount,
      upcomingSessions,
      upcomingSessionsLoading,
      fetchUpcomingSessions,
      companyName,
      fetchCompanyBranding,
      dropdownOptions,
      dropdownCategories,
      serviceTypeOptions,
      statusOptions,
      locationOptions,
      groupSizeOptions,
      serviceTypeMap,
      statusCodeMap,
      locationCodeMap,
      fetchDropdownOptions,
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
