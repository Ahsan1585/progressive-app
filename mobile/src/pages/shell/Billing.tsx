import * as React from "react";
import { FileText, ChevronRight, Clock, Building2, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "@/api/axiosInstance";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { formatHoursMinutes } from "@/utils/time";
import type { PractitionerDashboardSummary, AgencyBreakdownEntry, AgencyPendingEntry } from "@/types";

const money = (n: number) => `$${n.toFixed(2)}`;

// Tab root for an independent practitioner (replaces Messages in the tab
// bar — see TabBar.tsx). Scoped purely to billable-session activity
// (what's ready to invoice, what's already been invoiced, who it's billed
// to) — their own account subscription/payment method lives under
// Profile > My subscription instead (moved out so this tab isn't mixing
// "what I'm owed" with "what I owe Izaya").
export default function Billing() {
  const navigate = useNavigate();
  const [summary, setSummary] = React.useState<PractitionerDashboardSummary | null>(null);
  const [invoicedByAgency, setInvoicedByAgency] = React.useState<AgencyBreakdownEntry[]>([]);
  const [pendingByAgency, setPendingByAgency] = React.useState<AgencyPendingEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [summaryRes, agencyRes] = await Promise.all([
        api.get<{ success: boolean } & PractitionerDashboardSummary>("/api/practitioner-dashboard/summary"),
        api.get<{ success: boolean; invoiced: AgencyBreakdownEntry[]; pending: AgencyPendingEntry[] }>("/api/practitioner-dashboard/by-agency"),
      ]);
      setSummary(summaryRes.data);
      setInvoicedByAgency(agencyRes.data.invoiced || []);
      setPendingByAgency(agencyRes.data.pending || []);
    } catch {
      setError("Couldn't load your billing activity.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="flex min-h-full flex-col overflow-y-auto px-4 py-5">
      <h1 className="mb-4 text-[22px] font-bold text-ink">Billing</h1>

      {error ? (
        <InlineErrorBanner message={error} onRetry={fetchData} />
      ) : isLoading ? (
        <div className="mb-4 space-y-3">
          <Skeleton className="h-[120px] w-full" />
          <Skeleton className="h-[72px] w-full" />
        </div>
      ) : (
        summary && (
          <>
            {summary.pendingValue > 0 && (
              <button
                type="button"
                onClick={() => navigate("/generate-sevf")}
                className="press-scale mb-4 flex w-full items-center gap-3 rounded-card border border-primary/30 bg-primary-tint p-4 text-left shadow-[var(--elev-rest)]"
              >
                <AlertCircle className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex-1 text-[15px] font-semibold text-ink">
                  {money(summary.pendingValue)} ready to invoice
                </span>
                <ChevronRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
              </button>
            )}

            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
                <p className="text-[13px] font-semibold text-ink-muted">Invoiced this month</p>
                <p className="tabular mt-1 text-[22px] font-bold text-ink">{money(summary.invoicedThisMonth)}</p>
              </div>
              <div className="rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
                <p className="text-[13px] font-semibold text-ink-muted">Sessions this month</p>
                <p className="tabular mt-1 text-[22px] font-bold text-ink">{summary.sessionsSubmittedThisMonth}</p>
              </div>
            </div>
          </>
        )
      )}

      <button
        type="button"
        onClick={() => navigate("/generate-sevf")}
        className="press-scale flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
      >
        <FileText className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="flex-1 text-[15px] font-medium text-ink">Generate SEVF</span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => navigate("/sevf-history")}
        className="press-scale mt-3 flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
      >
        <Clock className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="flex-1 text-[15px] font-medium text-ink">SEVF History</span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => navigate("/profile/agencies")}
        className="press-scale mt-3 flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
      >
        <Building2 className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="flex-1 text-[15px] font-medium text-ink">Manage agencies</span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
      </button>

      {!isLoading && pendingByAgency.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 text-[13px] font-semibold text-ink-muted">Pending by agency (all time)</h2>
          <div className="divide-y divide-border rounded-card border border-primary/30 bg-primary-tint shadow-[var(--elev-rest)]">
            {pendingByAgency.map((a) => (
              <div key={a.name} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink">{a.name}</p>
                  <p className="text-xs text-ink-muted">{formatHoursMinutes(a.hours)} logged, no SEVF yet</p>
                </div>
                <p className="tabular text-[15px] font-semibold text-ink">{money(a.pendingValue)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && invoicedByAgency.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 text-[13px] font-semibold text-ink-muted">Invoiced by agency this month</h2>
          <div className="divide-y divide-border rounded-card border border-border bg-surface shadow-[var(--elev-rest)]">
            {invoicedByAgency.map((a) => (
              <div key={a.name} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink">{a.name}</p>
                  <p className="text-xs text-ink-muted">{formatHoursMinutes(a.hours)}</p>
                </div>
                <p className="tabular text-[15px] font-semibold text-ink">{money(a.invoicedValue)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
