import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { StatTile } from "@/components/StatTile";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";

export default function Home() {
  const { practitioner } = useAuth();
  const { stats, statsLoading, statsError, fetchStats, rejectedLogs, rejectedLoading } = useAppData();
  const navigate = useNavigate();

  return (
    <div className="safe-top flex-1 px-4 pb-6 pt-5">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-muted">Welcome back</p>
          <h1 className="text-[20px] font-semibold leading-[26px] text-ink">
            {practitioner?.firstName ?? "Practitioner"}
          </h1>
        </div>
        <span className="flex size-2 rounded-full bg-success" title="Session active" aria-hidden="true" />
      </header>

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
  );
}
