import * as React from "react";
import { FileText, Printer, RotateCcw, FolderOpen } from "lucide-react";
import api from "@/api/axiosInstance";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate } from "@/utils/time";
import type { GeneratedSevfResult, ApiErrorBody } from "@/types";

// Independent-practitioner-only — every SEVF this practitioner has ever
// generated (see billingController.js's getSelfCertifiedHistory), reachable
// from the Billing tab. Lets a mistake (wrong agency/month, or logs that
// should've been combined with others) be found and reverted, not just
// visible for the few seconds right after generating on GenerateSevf.tsx.
export default function SevfHistory() {
  const { showToast } = useToast();
  const [batches, setBatches] = React.useState<GeneratedSevfResult[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [revertTarget, setRevertTarget] = React.useState<GeneratedSevfResult | null>(null);
  const [isReverting, setIsReverting] = React.useState(false);

  const fetchHistory = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<{ success: boolean; batches: GeneratedSevfResult[] }>(
        "/api/billing/independent/history"
      );
      setBatches(res.data.batches || []);
    } catch {
      setError("Couldn't load your SEVF history.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handlePrint = (result: GeneratedSevfResult) => {
    if (!result.downloadUrl) {
      showToast("This SEVF's file couldn't be found.", "error");
      return;
    }
    // Same synchronous-window.open-before-await pattern as MyInvoices.tsx's
    // handleView — iOS Safari (including installed PWA mode) blocks
    // window.open() once anything async happens first.
    window.open(result.downloadUrl, "_blank");
  };

  const handleRevert = async () => {
    if (!revertTarget) return;
    setIsReverting(true);
    try {
      await api.post("/api/billing/independent/revert-sevf", { batchId: revertTarget.batchId });
      showToast("SEVF reverted — sessions are ready to generate again.", "success");
      setRevertTarget(null);
      fetchHistory();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't revert this SEVF. Please try again.", "error");
    } finally {
      setIsReverting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="SEVF History" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {error ? (
          <InlineErrorBanner message={error} onRetry={fetchHistory} />
        ) : isLoading ? (
          <ul className="space-y-2" aria-label="Loading SEVF history">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-[88px] w-full" />
              </li>
            ))}
          </ul>
        ) : batches.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            heading="No SEVFs generated yet"
            subtext="SEVFs you generate will show up here, with the option to print or revert a mistake."
          />
        ) : (
          <ul role="list" className="space-y-2">
            {batches.map((b) => (
              <li key={b.batchId} className="rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
                    <FileText className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-ink">{b.patientName}</p>
                    <p className="text-xs text-ink-muted">
                      {b.companyAffiliation || "No agency"} · {b.month}
                    </p>
                    {b.generatedAt && (
                      <p className="text-xs text-ink-faint">Generated {formatSafeDate(b.generatedAt)}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => handlePrint(b)}>
                    <Printer className="size-4" aria-hidden="true" /> Print
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setRevertTarget(b)}>
                    <RotateCcw className="size-4" aria-hidden="true" /> Revert
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!revertTarget}
        onOpenChange={(open) => !open && setRevertTarget(null)}
        title="Revert this SEVF?"
        description={
          revertTarget
            ? `${revertTarget.patientName}'s sessions from ${revertTarget.month} (${revertTarget.companyAffiliation || "no agency"}) will go back to ready-to-generate, and this SEVF file will be deleted. You can regroup and generate them again.`
            : ""
        }
        confirmLabel="Revert"
        destructive
        loading={isReverting}
        onConfirm={handleRevert}
      />
    </PushScreen>
  );
}
