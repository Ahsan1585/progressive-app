import * as React from "react";
import { FileText, Printer, RotateCcw, FolderOpen, Send } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const { fetchAgencies } = useAppData();
  const [batches, setBatches] = React.useState<GeneratedSevfResult[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [revertTarget, setRevertTarget] = React.useState<GeneratedSevfResult | null>(null);
  const [isReverting, setIsReverting] = React.useState(false);
  const [emailTarget, setEmailTarget] = React.useState<GeneratedSevfResult | null>(null);
  const [agencyEmail, setAgencyEmail] = React.useState("");
  const [saveEmailForAgency, setSaveEmailForAgency] = React.useState(false);
  const [isSendingEmail, setIsSendingEmail] = React.useState(false);

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

  const handlePrintInvoice = (result: GeneratedSevfResult) => {
    if (!result.invoiceDownloadUrl) {
      showToast("This invoice's file couldn't be found.", "error");
      return;
    }
    window.open(result.invoiceDownloadUrl, "_blank");
  };

  const openEmailDialog = (result: GeneratedSevfResult) => {
    setEmailTarget(result);
    setAgencyEmail(result.agencyEmail || "");
    setSaveEmailForAgency(!result.agencyEmail);
  };

  const handleSendEmail = async () => {
    if (!emailTarget || !agencyEmail.trim()) return;
    setIsSendingEmail(true);
    try {
      await api.post("/api/billing/independent/email-sevf", {
        batchId: emailTarget.batchId,
        agencyEmail: agencyEmail.trim(),
      });
      if (saveEmailForAgency && !emailTarget.agencyEmail && emailTarget.companyAffiliation) {
        try {
          await api.post("/api/agencies", { name: emailTarget.companyAffiliation, email: agencyEmail.trim() });
          fetchAgencies();
        } catch {
          // Non-critical — the email still sent; just didn't get saved for next time.
        }
      }
      showToast(
        emailTarget.invoiceDownloadUrl ? "SEVF and invoice emailed to the agency." : "SEVF emailed to the agency.",
        "success"
      );
      setEmailTarget(null);
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't send the email. Please try again.", "error");
    } finally {
      setIsSendingEmail(false);
    }
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
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => handlePrint(b)}>
                    <Printer className="size-4" aria-hidden="true" /> SEVF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handlePrintInvoice(b)}>
                    <FileText className="size-4" aria-hidden="true" /> Invoice
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEmailDialog(b)}>
                    <Send className="size-4" aria-hidden="true" /> Email
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRevertTarget(b)}>
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

      <Dialog open={!!emailTarget} onOpenChange={(open) => !open && setEmailTarget(null)}>
        <DialogContent aria-labelledby="email-sevf-history-dialog-title">
          <DialogHeader>
            <DialogTitle id="email-sevf-history-dialog-title">Email SEVF to agency</DialogTitle>
            <DialogDescription>
              Send {emailTarget?.patientName}'s SEVF{emailTarget?.invoiceDownloadUrl ? " and invoice" : ""} ({emailTarget?.month}) directly to the agency's email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="historyAgencyEmail" className="text-xs">Agency email</Label>
            <Input
              id="historyAgencyEmail"
              type="email"
              placeholder="billing@agency.org"
              value={agencyEmail}
              onChange={(e) => setAgencyEmail(e.target.value)}
              autoFocus={!emailTarget?.agencyEmail}
            />
            {!emailTarget?.agencyEmail && emailTarget?.companyAffiliation && (
              <label className="flex items-center gap-2 pt-1 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={saveEmailForAgency}
                  onChange={(e) => setSaveEmailForAgency(e.target.checked)}
                  className="size-4 accent-primary"
                />
                Save this as {emailTarget.companyAffiliation}'s email for next time
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailTarget(null)} disabled={isSendingEmail}>
              Cancel
            </Button>
            <Button onClick={handleSendEmail} disabled={isSendingEmail || !agencyEmail.trim()}>
              {isSendingEmail ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PushScreen>
  );
}
