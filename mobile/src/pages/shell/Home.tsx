import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { StatTile } from "@/components/StatTile";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";

export default function Home() {
  const { practitioner } = useAuth();
  const { stats, statsLoading, statsError, fetchStats, rejectedLogs, rejectedLoading, patients, patientsLoading } = useAppData();
  const navigate = useNavigate();

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
          <p className="text-sm text-ink-muted">Welcome back,</p>
          <h1 className="truncate text-[20px] font-semibold capitalize leading-[26px] text-ink">
            {practitioner ? `${practitioner.firstName} ${practitioner.lastName}` : "Practitioner"}
          </h1>
        </div>
        <span className="flex size-2 shrink-0 rounded-full bg-success" title="Session active" aria-hidden="true" />
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
    </div>
  );
}
