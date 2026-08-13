import * as React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ClipboardList, Plus, Pencil, CalendarPlus, CalendarClock, ChevronRight, X, Trash2, PencilLine } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { ScheduleSessionSheet } from "@/components/ScheduleSessionSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DraftCapDialog } from "@/components/DraftCapDialog";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate, formatTime12h, timeAgo } from "@/utils/time";
import { MAX_DRAFTS_PER_PATIENT } from "@/constants/drafts";
import type { Assessment, ScheduledSession, SessionDraftListItem } from "@/types";

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { patients, fetchPatients, serviceTypeMap, locationCodeMap, statusCodeMap } = useAppData();
  const patient = patients.find((p) => String(p.id) === id);
  const [updatingStatus, setUpdatingStatus] = React.useState(false);

  const { showToast } = useToast();
  const [assessments, setAssessments] = React.useState<Assessment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [sessions, setSessions] = React.useState<ScheduledSession[]>([]);
  const [scheduleTarget, setScheduleTarget] = React.useState<ScheduledSession | "new" | null>(null);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = React.useState<Assessment | null>(null);
  const [isDeletingLog, setIsDeletingLog] = React.useState(false);

  const [drafts, setDrafts] = React.useState<SessionDraftListItem[]>([]);
  const [discardDraftTarget, setDiscardDraftTarget] = React.useState<string | null>(null); // draft id, or null
  const [isDiscardingDraft, setIsDiscardingDraft] = React.useState(false);
  const [checkingNewLog, setCheckingNewLog] = React.useState(false);
  const [draftCapDialogOpen, setDraftCapDialogOpen] = React.useState(false);

  const fetchSessions = React.useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.get<ScheduledSession[]>("/api/schedule", { params: { patientId: id } });
      setSessions(res.data.filter((s) => s.status === "scheduled"));
    } catch {
      // Non-critical — the upcoming-sessions list just stays empty.
    }
  }, [id]);

  const fetchDrafts = React.useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.get<{ success: boolean; drafts: SessionDraftListItem[] }>(`/api/session-drafts/patient/${id}`);
      setDrafts(res.data.drafts || []);
    } catch {
      // Non-critical — the resume-draft banner just stays hidden.
    }
  }, [id]);

  React.useEffect(() => {
    fetchSessions();
    fetchDrafts();
  }, [fetchSessions, fetchDrafts]);

  const handleDiscardDraft = async () => {
    if (!discardDraftTarget) return;
    setIsDiscardingDraft(true);
    try {
      await api.delete(`/api/session-drafts/${discardDraftTarget}`);
      setDrafts((prev) => prev.filter((d) => d.id !== discardDraftTarget));
      showToast("Draft discarded.");
      setDiscardDraftTarget(null);
    } catch {
      showToast("Couldn't discard draft. Try again.");
    } finally {
      setIsDiscardingDraft(false);
    }
  };

  // Re-checks fresh rather than trusting `drafts` (set once on mount) — a
  // tap that lands before that initial fetch resolves would otherwise read
  // the still-empty initial state and let a 3rd draft slip past the cap.
  const handleStartNewLog = async () => {
    if (!id || checkingNewLog) return;
    setCheckingNewLog(true);
    try {
      const res = await api.get<{ success: boolean; drafts: SessionDraftListItem[] }>(`/api/session-drafts/patient/${id}`);
      const current = res.data.drafts || [];
      setDrafts(current);
      if (current.length >= MAX_DRAFTS_PER_PATIENT) {
        setDraftCapDialogOpen(true);
        return;
      }
      navigate(`/patients/${id}/log`);
    } catch {
      // Fails open — the backend still enforces the real cap on save, this
      // preemptive check is purely a UX convenience.
      navigate(`/patients/${id}/log`);
    } finally {
      setCheckingNewLog(false);
    }
  };

  // Arriving here from Home's "Schedule a session" link (via the Patients
  // tab's scheduleIntent hand-off) opens the sheet immediately instead of
  // making the practitioner tap Schedule again. Clear the state afterward
  // so it doesn't reopen if they navigate back to this page later.
  React.useEffect(() => {
    if ((location.state as { scheduleIntent?: boolean } | null)?.scheduleIntent) {
      setScheduleTarget("new");
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancelSession = async (sessionId: string) => {
    setCancellingId(sessionId);
    try {
      await api.patch(`/api/schedule/${sessionId}/cancel`);
      showToast("Session cancelled.");
      fetchSessions();
    } catch {
      showToast("Couldn't cancel this session. Please try again.");
    } finally {
      setCancellingId(null);
    }
  };

  const handleToggleStatus = async () => {
    if (!patient) return;
    const nextStatus = patient.status === "inactive" ? "active" : "inactive";
    setUpdatingStatus(true);
    try {
      await api.patch(`/api/patients/${id}/status`, { status: nextStatus });
      await fetchPatients();
    } catch {
      // Silent — the pill just won't have changed; user can retry the tap.
    } finally {
      setUpdatingStatus(false);
    }
  };

  const fetchAssessments = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Assessment[]>(`/api/patients/${id}/assessments`);
      setAssessments(res.data);
    } catch {
      // Includes the 403/not-owner edge case — generic message, no ownership detail leaked.
      setError("Something went wrong loading this patient.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleDeleteLog = async () => {
    if (!deleteTarget) return;
    setIsDeletingLog(true);
    try {
      await api.delete(`/api/patients/logs/${deleteTarget.id}`);
      setAssessments((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      showToast("Log deleted.");
      setDeleteTarget(null);
    } catch (err) {
      const body = (err as { response?: { data?: { error?: string } } }).response?.data;
      showToast(body?.error || "Couldn't delete this log. Please try again.");
    } finally {
      setIsDeletingLog(false);
    }
  };

  React.useEffect(() => {
    fetchAssessments();
  }, [fetchAssessments]);

  const title = patient ? `${patient.first_name} ${patient.last_name}` : "Patient";

  return (
    <PushScreen>
      <AppBar
        title={title}
        trailing={
          patient && (
            <button
              type="button"
              onClick={() => navigate(`/patients/${id}/edit`)}
              aria-label="Edit patient"
              className="press-scale flex size-11 items-center justify-center rounded-control text-ink hover:bg-surface-sunken"
            >
              <Pencil className="size-5" aria-hidden="true" />
            </button>
          )
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {patient && (
          <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
            <h2 className="text-[20px] font-semibold capitalize leading-[26px] text-ink">
              {patient.first_name}
              {patient.middle_name ? ` ${patient.middle_name}` : ""} {patient.last_name}
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Child ID</p>
                <p className="tabular text-sm font-medium text-ink">{patient.child_id}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Date of birth</p>
                <p className="text-sm font-medium text-ink">{formatSafeDate(patient.dob)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">County</p>
                <p className="text-sm font-medium capitalize text-ink">{patient.county || "N/A"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Status</p>
                <button
                  type="button"
                  onClick={handleToggleStatus}
                  disabled={updatingStatus}
                  className={
                    "mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold disabled:opacity-50 " +
                    (patient.status === "inactive"
                      ? "border-border-strong bg-surface-sunken text-ink-muted"
                      : "border-success-border bg-success-bg text-success")
                  }
                >
                  {patient.status === "inactive" ? "Inactive" : "Active"}
                </button>
              </div>
            </div>
          </div>
        )}

        {drafts.length > 0 && (
          <div className="mb-4 space-y-2">
            {drafts.map((d) => (
              <div key={d.id} className="flex items-center gap-1 rounded-card border border-border bg-surface pr-1 shadow-[var(--elev-rest)]">
                <button
                  type="button"
                  onClick={() => navigate(`/patients/${id}/log?draftId=${d.id}`)}
                  className="press-scale flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
                    <PencilLine className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">Resume draft</p>
                    <p className="text-xs text-ink-muted">Saved {timeAgo(d.updated_at)}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Discard draft"
                  onClick={() => setDiscardDraftTarget(d.id)}
                  className="press-scale flex size-9 shrink-0 items-center justify-center rounded-control text-ink-faint hover:text-danger"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Sticky "Log Session" primary action — always reachable without scrolling. */}
        <div className="sticky top-0 z-10 -mx-4 mb-4 bg-bg px-4 pb-3 pt-1">
          <Button
            className="w-full"
            size="lg"
            disabled={patient?.status === "inactive" || checkingNewLog}
            onClick={handleStartNewLog}
          >
            <Plus className="size-4" aria-hidden="true" />
            Log Session
          </Button>
          {patient?.status === "inactive" && (
            <p className="mt-1.5 text-center text-xs text-ink-muted">Reactivate this patient to log a new session.</p>
          )}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-ink">Upcoming sessions</h3>
            <button
              type="button"
              onClick={() => setScheduleTarget("new")}
              className="press-scale flex items-center gap-1 text-xs font-semibold text-primary"
            >
              <CalendarPlus className="size-3.5" aria-hidden="true" />
              Schedule
            </button>
          </div>
          {sessions.length === 0 ? (
            <p className="text-sm text-ink-muted">No upcoming sessions scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-card border border-border bg-surface p-3 shadow-[var(--elev-rest)]">
                  <div className="min-w-0">
                    <p className="tabular text-sm font-semibold text-ink">{formatSafeDate(s.session_date)}</p>
                    <p className="tabular text-xs text-ink-muted">
                      {formatTime12h(s.start_time)} - {formatTime12h(s.end_time)}
                      {s.location ? ` · ${s.location}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setScheduleTarget(s)}
                      aria-label="Reschedule"
                      className="press-scale flex size-9 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken"
                    >
                      <CalendarClock className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelSession(s.id)}
                      disabled={cancellingId === s.id}
                      aria-label="Cancel session"
                      className="press-scale flex size-9 items-center justify-center rounded-control text-danger hover:bg-danger-bg disabled:opacity-50"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <h3 className="mb-2 text-[15px] font-semibold text-ink">Encounter history</h3>

        {error ? (
          <EmptyState
            icon={ClipboardList}
            heading="Something went wrong loading this patient"
            action={
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={fetchAssessments}>
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate("/roster")}>
                  Back to roster
                </Button>
              </div>
            }
          />
        ) : loading ? (
          <ul className="space-y-2" aria-label="Loading encounter history">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-20 w-full" />
              </li>
            ))}
          </ul>
        ) : assessments.length === 0 ? (
          <EmptyState icon={ClipboardList} heading={`No visits logged yet for ${patient?.first_name ?? "this patient"}`} />
        ) : (
          <ul role="list" aria-label="Encounter history" className="space-y-2">
            {assessments.map((item) => (
              <li key={item.id} className="rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="tabular text-sm font-semibold text-ink">{formatSafeDate(item.service_date)}</p>
                    <p className="mt-0.5 text-sm text-ink-body">{serviceTypeMap[item.type] || item.type}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{locationCodeMap[item.location] || item.location}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge status={item.billing_status} />
                    <p className="tabular text-sm font-semibold text-ink">{(item.total_time / 60).toFixed(2)} hrs</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                  <span className="tabular">
                    {formatTime12h(item.start_time)} - {formatTime12h(item.end_time)}
                  </span>
                  <span className="font-semibold uppercase tracking-wide">{statusCodeMap[item.status] || item.status}</span>
                </div>
                {item.billing_status === "pending" && (
                  <div className="mt-2 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => navigate(`/patients/${id}/logs/${item.id}/edit`)}
                      className="press-scale flex items-center gap-1 text-xs font-semibold text-primary"
                    >
                      <PencilLine className="size-3.5" aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      className="press-scale flex items-center gap-1 text-xs font-semibold text-danger"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ScheduleSessionSheet
        target={scheduleTarget}
        patientId={id || ""}
        parentEmail={patient?.parent_email}
        onOpenChange={(open) => !open && setScheduleTarget(null)}
        onSaved={() => {
          setScheduleTarget(null);
          fetchSessions();
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this log?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={isDeletingLog}
        onConfirm={handleDeleteLog}
      />

      <ConfirmDialog
        open={!!discardDraftTarget}
        onOpenChange={(open) => { if (!open) setDiscardDraftTarget(null); }}
        title="Discard this draft?"
        description="This will permanently delete this saved draft. This cannot be undone."
        confirmLabel="Discard"
        destructive
        loading={isDiscardingDraft}
        onConfirm={handleDiscardDraft}
      />

      <DraftCapDialog
        open={draftCapDialogOpen}
        onOpenChange={setDraftCapDialogOpen}
        patientName={patient ? `${patient.first_name} ${patient.last_name}`.trim() : undefined}
      />
    </PushScreen>
  );
}
