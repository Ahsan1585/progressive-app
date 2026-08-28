import * as React from "react";
import { FileText, Receipt } from "lucide-react";
import api from "@/api/axiosInstance";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate } from "@/utils/time";
import { cn } from "@/lib/utils";
import type { Invoice, ApiErrorBody } from "@/types";

// Practitioner self-service view of their own approved invoices (issued by
// billing) — mirrors admin's Completed Bills paid/unpaid distinction, but
// scoped to just this practitioner and read-only (view/download only).
export default function MyInvoices() {
  const { showToast } = useToast();
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  const fetchInvoices = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ success: boolean; invoices: Invoice[] }>("/api/billing/my-invoices");
      setInvoices(res.data.invoices || []);
    } catch {
      setError("Couldn't load your invoices.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleView = async (invoice: Invoice) => {
    setDownloadingId(invoice.id);
    // iOS Safari (including an installed PWA's standalone mode) only allows
    // window.open() to succeed when it's called synchronously within the
    // click's own event handler — once anything is awaited first, the
    // popup is silently blocked with no error. Android Chrome doesn't
    // enforce this as strictly, which is why this worked there but not on
    // iPhone. Opening a blank tab right now, before the await, and
    // navigating it once the real URL is known keeps the open() call
    // itself synchronous.
    const newWindow = window.open("", "_blank");
    try {
      const res = await api.get<{ success: boolean; signedUrl: string }>(`/api/billing/my-invoices/${invoice.id}/download`);
      if (newWindow) {
        newWindow.location.href = res.data.signedUrl;
      } else {
        // Popups fully disabled (window.open returned null outright) —
        // fall back to a same-tab navigation so the invoice still opens.
        window.location.href = res.data.signedUrl;
      }
    } catch (err) {
      newWindow?.close();
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't open this invoice. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <PushScreen>
      <AppBar title="My Invoices" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {error ? (
          <InlineErrorBanner message={error} onRetry={fetchInvoices} />
        ) : loading ? (
          <ul className="space-y-2" aria-label="Loading invoices">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-[72px] w-full" />
              </li>
            ))}
          </ul>
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            heading="No invoices yet"
            subtext="Approved invoices will show up here once billing issues them."
          />
        ) : (
          <ul role="list" className="space-y-2">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <button
                  type="button"
                  onClick={() => handleView(invoice)}
                  disabled={downloadingId === invoice.id}
                  className="press-scale flex w-full items-center gap-3 rounded-card border border-border bg-surface p-3.5 text-left shadow-[var(--elev-rest)] disabled:opacity-60"
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
                    <FileText className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="tabular text-[15px] font-semibold text-ink">
                      {formatSafeDate(invoice.start_date)} – {formatSafeDate(invoice.end_date)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {invoice.paid ? `Paid ${formatSafeDate(invoice.paid_at)}` : "Approved — payment pending"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                      invoice.paid
                        ? "border-success-border bg-success-bg text-success"
                        : "border-warning-border bg-warning-bg text-warning"
                    )}
                  >
                    {invoice.paid ? "Paid" : "Approved"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PushScreen>
  );
}
