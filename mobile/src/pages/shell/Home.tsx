import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarPlus, ChevronRight, ClipboardList, MapPin, PencilLine, RefreshCw, Trash2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { StatTile } from "@/components/StatTile";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import api from "@/api/axiosInstance";
import { formatTime12h } from "@/utils/time";
import { cn } from "@/lib/utils";
import type { ScheduledSession } from "@/types";

// Coarse relative-time label for a draft's last-saved timestamp (e.g. "2
// hours ago", "3 days ago") — good enough for "how stale is this draft",
// no need for a precise duration.
function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

// Buckets upcoming sessions into calendar-relative groups (Today / Tomorrow /
// weekday name within the next week / "Mon D" beyond that). Sessions arrive
// pre-sorted by date+time from the backend, so a single pass preserves
// chronological order within and across groups — no re-sort needed.
function groupSessionsByDay(sessions: ScheduledSession[]) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const groups: { label: string; isToday: boolean; sessions: ScheduledSession[] }[] = [];
  for (const s of sessions) {
    const [y, m, d] = s.session_date.split("T")[0].split("-").map(Number);
    const sessionDate = new Date(y, m - 1, d);
    const diffDays = Math.round((sessionDate.getTime() - todayStart.getTime()) / 86400000);

    let label: string;
    if (diffDays === 0) label = "Today";
    else if (diffDays === 1) label = "Tomorrow";
    else if (diffDays > 1 && diffDays < 7) label = sessionDate.toLocaleDateString(undefined, { weekday: "long" });
    else label = sessionDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });

    const last = groups[groups.length - 1];
    if (last && last.label === label) last.sessions.push(s);
    else groups.push({ label, isToday: diffDays === 0, sessions: [s] });
  }
  return groups;
}

export default function Home() {
  const { practitioner } = useAuth();
  const {
    stats, statsLoading, statsError, fetchStats,
    rejectedLogs, rejectedLoading, fetchRejectedLogs,
    drafts, draftsLoading, fetchDrafts,
    patients, patientsLoading, fetchPatients,
    upcomingSessions, upcomingSessionsLoading, fetchUpcomingSessions,
    companyName,
  } = useAppData();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [refreshing, setRefreshing] = React.useState(false);
  const [discardTarget, setDiscardTarget] = React.useState<{ patient_id: string; name: string } | null>(null);
  const [isDiscarding, setIsDiscarding] = React.useState(false);

  const handleDiscardDraft = async () => {
    if (!discardTarget) return;
    setIsDiscarding(true);
    try {
      await api.delete(`/api/session-drafts/${discardTarget.patient_id}`);
      showToast("Draft discarded.");
      setDiscardTarget(null);
      fetchDrafts({ silent: true });
    } catch {
      showToast("Couldn't discard draft. Try again.");
    } finally {
      setIsDiscarding(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchStats(), fetchRejectedLogs(), fetchDrafts(), fetchPatients(), fetchUpcomingSessions()]);
    } finally {
      setRefreshing(false);
    }
  };

  // Route-level tab components fully unmount/remount on every navigation
  // (they're not kept alive in the background), so an empty-dep effect here
  // refetches automatically each time the practitioner lands on Home —
  // replaces the native pull-to-refresh gesture that pinning the page
  // (bounce/tab-bar-jitter fix) disabled. The header button above is a
  // manual override for while they're already sitting on the tab.
  React.useEffect(() => {
    fetchStats();
    fetchRejectedLogs();
    fetchDrafts();
    fetchPatients();
    fetchUpcomingSessions();
  }, [fetchStats, fetchRejectedLogs, fetchDrafts, fetchPatients, fetchUpcomingSessions]);

  const scheduleGroups = React.useMemo(() => groupSessionsByDay(upcomingSessions), [upcomingSessions]);

  // "Jump back in" — most recently serviced patients first (never-serviced
  // patients sort last), not just whatever order the roster happens to load in.
  const recentPatients = [...patients]
    .sort((a, b) => {
      if (!a.last_service_date && !b.last_service_date) return 0;
      if (!a.last_service_date) return 1;
      if (!b.last_service_date) return -1;
      return b.last_service_date.localeCompare(a.last_service_date);
    })
    .slice(0, 5);

  return (
    <div className="safe-top flex flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-bg px-4 pb-3 pt-5">
        <div className="min-w-0">
          {companyName && (
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-ink-faint">{companyName}</p>
          )}
          <p className="text-sm text-ink-muted">Welcome back,</p>
          <h1 className="truncate text-[20px] font-semibold capitalize leading-[26px] text-ink">
            {practitioner ? `${practitioner.firstName} ${practitioner.lastName}` : "Practitioner"}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/roster")}
          aria-label="Select a patient"
          title="Select a patient"
          className="press-scale flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken"
        >
          <Users className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh"
          className="press-scale flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken disabled:opacity-60"
        >
          <RefreshCw className={cn("size-5", refreshing && "animate-spin")} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 px-4 py-3">

      {statsError ? (
        <InlineErrorBanner message={statsError} onRetry={fetchStats} className="mb-6" />
      ) : (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <StatTile label="Logs this month" value={stats?.logsThisMonth ?? null} loading={statsLoading} />
          <StatTile
            label="Hours this month"
            value={stats?.hoursThisMonth ?? null}
            loading={statsLoading}
            formatter={(n) => n.toFixed(1)}
          />
          <StatTile label="In pipeline" value={stats?.pendingReviewCount ?? null} loading={statsLoading} />
        </div>
      )}

      {!patientsLoading && patients.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Jump back in</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {recentPatients.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/patients/${p.id}`)}
                className="press-scale flex-shrink-0 whitespace-nowrap rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-semibold capitalize text-ink"
              >
                {p.first_name} {p.last_name?.[0]}.
              </button>
            ))}
            {patients.length > 5 && (
              <button
                type="button"
                onClick={() => navigate("/roster")}
                className="press-scale flex-shrink-0 whitespace-nowrap rounded-full border border-border bg-surface-sunken px-4 py-2 text-sm font-semibold text-ink-muted"
              >
                +{patients.length - 5} more
              </button>
            )}
          </div>
        </div>
      )}

      {!draftsLoading && drafts.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Continue where you left off</p>
          <ul role="list" className="space-y-2">
            {drafts.map((d) => (
              <li
                key={d.patient_id}
                className="flex items-center gap-1 rounded-card border border-border bg-surface pr-1 shadow-[var(--elev-rest)]"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/patients/${d.patient_id}/log`)}
                  className="press-scale flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
                    <PencilLine className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold capitalize text-ink">
                      {d.patient_first_name} {d.patient_last_name}
                    </p>
                    <p className="text-xs text-ink-muted">Draft saved {timeAgo(d.updated_at)}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Discard draft"
                  onClick={() =>
                    setDiscardTarget({ patient_id: d.patient_id, name: `${d.patient_first_name} ${d.patient_last_name}`.trim() })
                  }
                  className="press-scale flex size-9 shrink-0 items-center justify-center rounded-control text-ink-faint hover:text-danger"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!upcomingSessionsLoading && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Your Schedule</p>
            {upcomingSessions.length > 0 && (
              <p className="tabular text-xs text-ink-faint">
                {upcomingSessions.length} upcoming
              </p>
            )}
          </div>
          {upcomingSessions.length === 0 ? (
            <div className="rounded-card border border-border bg-surface p-4 text-center">
              <p className="mb-3 text-sm text-ink-muted">No scheduled appointments</p>
              <button
                type="button"
                onClick={() => navigate("/roster", { state: { scheduleIntent: true } })}
                className="press-scale inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
              >
                <CalendarPlus className="size-4" aria-hidden="true" />
                Schedule a session
              </button>
            </div>
          ) : (
          <>
          <div className="space-y-4">
            {scheduleGroups.map((group) => (
              <div key={group.label}>
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  {group.isToday && <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />}
                  <p className={cn("text-xs font-semibold", group.isToday ? "text-primary" : "text-ink-muted")}>
                    {group.label}
                  </p>
                </div>
                <ul role="list" className="space-y-2">
                  {group.sessions.map((s) => {
                    const [, month, day] = s.session_date.split("T")[0].split("-");
                    const monthLabel = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleDateString(undefined, { month: "short" });
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/patients/${s.patient_id}`)}
                          className="press-scale flex w-full items-center gap-3 rounded-card border border-border bg-surface p-3 text-left shadow-[var(--elev-rest)]"
                        >
                          <div
                            className={cn(
                              "flex size-11 shrink-0 flex-col items-center justify-center rounded-control",
                              group.isToday ? "bg-primary text-primary-fg" : "bg-surface-sunken text-ink"
                            )}
                          >
                            <span className="text-[9px] font-bold uppercase leading-none">{monthLabel}</span>
                            <span className="tabular text-[15px] font-bold leading-tight">{parseInt(day, 10)}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-semibold capitalize text-ink">
                              {s.patient_first_name} {s.patient_last_name}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                              <span className="tabular">
                                {formatTime12h(s.start_time)} – {formatTime12h(s.end_time)}
                              </span>
                              {s.location && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="flex items-center gap-0.5 truncate">
                                    <MapPin className="size-3 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{s.location}</span>
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigate("/roster", { state: { scheduleIntent: true } })}
            className="press-scale mt-3 flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-border-strong p-3 text-sm font-semibold text-primary"
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
            Schedule a session
          </button>
          </>
          )}
        </div>
      )}

      {!rejectedLoading && rejectedLogs.length > 0 && (
        <button
          type="button"
          onClick={() => navigate("/inbox")}
          className="press-scale flex w-full items-center gap-3 rounded-card border border-danger-border bg-danger-bg p-4 text-left"
        >
          <AlertTriangle className="size-5 shrink-0 text-danger" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-danger">
              {rejectedLogs.length} log{rejectedLogs.length > 1 ? "s" : ""} need your attention
            </p>
            <p className="text-xs text-danger/80">Resubmit or acknowledge billing feedback in your Inbox.</p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-danger" aria-hidden="true" />
        </button>
      )}
      </div>

      <div className="safe-bottom sticky bottom-0 z-10 border-t border-border bg-bg px-4 py-3">
        <Button
          className="w-full"
          size="lg"
          onClick={() => navigate("/roster", { state: { logIntent: true } })}
        >
          <ClipboardList className="size-5" aria-hidden="true" />
          Log a Session
        </Button>
      </div>

      <ConfirmDialog
        open={!!discardTarget}
        onOpenChange={(open) => { if (!open) setDiscardTarget(null); }}
        title="Discard this draft?"
        description={`This will permanently delete the saved draft for ${discardTarget?.name ?? "this child"}. This cannot be undone.`}
        confirmLabel="Discard"
        destructive
        loading={isDiscarding}
        onConfirm={handleDiscardDraft}
      />
    </div>
  );
}
