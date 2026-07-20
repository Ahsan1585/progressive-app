import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Inbox as InboxIcon, ChevronRight } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { AcknowledgeDeclineSheet } from "@/components/AcknowledgeDeclineSheet";
import { formatSafeDate } from "@/utils/time";
import { serviceTypeMap } from "@/constants/njeis";
import type { RejectedLog } from "@/types";

export default function Inbox() {
  const { rejectedLogs, rejectedLoading, rejectedError, fetchRejectedLogs } = useAppData();
  const navigate = useNavigate();
  const [acknowledging, setAcknowledging] = React.useState<RejectedLog | null>(null);

  // Refetch every time the practitioner lands on Inbox (route components
  // fully remount on navigation) — replaces the native pull-to-refresh
  // gesture disabled by the page-pinning bounce fix.
  React.useEffect(() => {
    fetchRejectedLogs();
  }, [fetchRejectedLogs]);

  return (
    <div className="safe-top flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg px-4 pb-3 pt-5">
        <h1 className="text-[20px] font-semibold leading-[26px] text-ink">Inbox</h1>
      </header>

      <div className="flex-1 px-4 py-3">
      {rejectedError ? (
        <InlineErrorBanner message={rejectedError} onRetry={fetchRejectedLogs} />
      ) : rejectedLoading ? (
        <ul className="space-y-2" aria-label="Loading inbox">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton className="h-24 w-full" />
            </li>
          ))}
        </ul>
      ) : rejectedLogs.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          heading="You're all caught up"
          subtext="No rejected or declined logs right now."
        />
      ) : (
        <ul role="list" aria-label="Rejected and declined logs" className="space-y-2">
          {rejectedLogs.map((log) => (
            <li key={log.id}>
              <button
                type="button"
                onClick={() =>
                  log.billing_status === "rejected" ? navigate(`/inbox/${log.id}/resubmit`) : setAcknowledging(log)
                }
                className="press-scale flex w-full flex-col gap-2 rounded-card border border-border bg-surface p-3.5 text-left shadow-[var(--elev-rest)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[15px] font-semibold capitalize text-ink">
                    {log.patient_first_name} {log.patient_last_name}
                  </p>
                  <StatusBadge status={log.billing_status} />
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="tabular">{formatSafeDate(log.service_date)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{serviceTypeMap[log.type] || log.type}</span>
                </div>
                {log.rejection_note && (
                  <p className="line-clamp-2 rounded-control bg-surface-sunken px-2.5 py-2 text-xs text-ink-body">
                    {log.rejection_note}
                  </p>
                )}
                <span className="flex items-center gap-1 text-xs font-medium text-primary">
                  {log.billing_status === "rejected" ? "Revise & resubmit" : "Acknowledge"}
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>

      <AcknowledgeDeclineSheet
        log={acknowledging}
        onOpenChange={(open) => !open && setAcknowledging(null)}
        onSuccess={() => {
          setAcknowledging(null);
          fetchRejectedLogs();
        }}
      />
    </div>
  );
}
