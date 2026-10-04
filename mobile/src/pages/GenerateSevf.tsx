import * as React from "react";
import { FileText, Send, Printer, FolderOpen, Check } from "lucide-react";
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
import { CompanyAffiliationFilter } from "@/components/CompanyAffiliationFilter";
import { PatientNameFilter } from "@/components/PatientNameFilter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate } from "@/utils/time";
import { cn } from "@/lib/utils";
import type { SelfCertifiedSession, GeneratedSevfResult, ApiErrorBody } from "@/types";

// Independent-practitioner-only SEVF self-certification screen. Unlike the
// office Batch Review flow, there is no "pending review" state to show —
// a logged session is already self-certified and generation-eligible the
// moment it's submitted (see billingController.js's generateSelfCertifiedSEVF).
// This screen's only two states are "ready to generate" (the filtered
// preview below) and "generated" (the results list with print/email actions).
export default function GenerateSevf() {
  const { showToast } = useToast();
  const { patients, agencies, fetchAgencies } = useAppData();
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [companyAffiliation, setCompanyAffiliation] = React.useState("");
  const [patientId, setPatientId] = React.useState<number | null>(null);

  // Every patient this practitioner has, for the "Child" filter dropdown.
  const patientOptions = React.useMemo(
    () => patients.map((p) => ({ id: Number(p.id), name: `${p.first_name} ${p.last_name}`.trim() })).sort((a, b) => a.name.localeCompare(b.name)),
    [patients]
  );

  const [sessions, setSessions] = React.useState<SelfCertifiedSession[]>([]);
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(true);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const [isGenerating, setIsGenerating] = React.useState(false);
  const [results, setResults] = React.useState<GeneratedSevfResult[]>([]);

  const [emailTarget, setEmailTarget] = React.useState<GeneratedSevfResult | null>(null);
  const [agencyEmail, setAgencyEmail] = React.useState("");
  const [saveEmailForAgency, setSaveEmailForAgency] = React.useState(false);
  const [isSendingEmail, setIsSendingEmail] = React.useState(false);

  const fetchPreview = React.useCallback(async () => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (companyAffiliation.trim()) params.companyAffiliation = companyAffiliation.trim();
      if (patientId != null) params.patientIds = String(patientId);
      const res = await api.get<{ success: boolean; sessions: SelfCertifiedSession[] }>(
        "/api/billing/independent/pending",
        { params }
      );
      const fetched = res.data.sessions || [];
      setSessions(fetched);
      // Default to everything selected — "Select all" is the common case,
      // and unchecking a few is less friction than checking every one.
      setSelectedIds(new Set(fetched.map((s) => s.id)));
    } catch {
      setPreviewError("Couldn't load your sessions.");
    } finally {
      setIsLoadingPreview(false);
    }
  }, [startDate, endDate, companyAffiliation, patientId]);

  React.useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const allSelected = sessions.length > 0 && selectedIds.size === sessions.length;

  const toggleSession = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(sessions.map((s) => s.id)));
  };

  // Groups selected sessions by the same 3-part key the backend groups by,
  // purely for the "N SEVFs will be generated" preview count — the backend
  // re-derives the real groups itself from whichever assessmentIds are sent.
  const selectedGroupKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const s of sessions) {
      if (selectedIds.has(s.id)) keys.add(s.groupKey);
    }
    return keys;
  }, [sessions, selectedIds]);

  const handleGenerate = async () => {
    if (selectedIds.size === 0) return;
    setIsGenerating(true);
    try {
      const res = await api.post<{ success: boolean; results: GeneratedSevfResult[]; message: string }>(
        "/api/billing/independent/generate-sevf",
        { assessmentIds: Array.from(selectedIds) }
      );
      setResults(res.data.results || []);
      setSessions([]);
      setSelectedIds(new Set());
      showToast(res.data.message, "success");
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't generate SEVF. Please try again.", "error");
    } finally {
      setIsGenerating(false);
    }
  };

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
    // Pre-filled from the saved Agency's email when one matches this
    // batch's agency name (see resolveAgencyEmail in agencyController.js) —
    // still a one-tap-to-confirm send, never auto-sent.
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
      // No agency was matched/had an email on file, but the practitioner
      // typed one and left the checkbox on — save it so this is pre-filled
      // automatically next time, matching Manage Agencies' own email field.
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

  return (
    <PushScreen>
      <AppBar title="Generate SEVF" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {results.length === 0 && (
          <div className="mb-5 space-y-3 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
            <p className="text-[13px] font-semibold text-ink-muted">Filters</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="startDate" className="text-xs">Start date</Label>
                <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate" className="text-xs">End date</Label>
                <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <PatientNameFilter value={patientId} onChange={setPatientId} options={patientOptions} />
            <CompanyAffiliationFilter
              value={companyAffiliation}
              onChange={setCompanyAffiliation}
              agencies={agencies}
            />
          </div>
        )}

        {results.length > 0 ? (
          <>
            <p className="mb-3 text-[13px] font-semibold text-ink-muted">
              {results.length} SEVF{results.length === 1 ? "" : "s"} and invoice{results.length === 1 ? "" : "s"} generated
            </p>
            <ul role="list" className="space-y-2">
              {results.map((r) => (
                <li key={r.batchId} className="rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
                      <FileText className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-ink">{r.patientName}</p>
                      <p className="text-xs text-ink-muted">
                        {r.companyAffiliation || "No agency"} · {r.month}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handlePrint(r)}>
                      <Printer className="size-4" aria-hidden="true" /> SEVF
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handlePrintInvoice(r)}>
                      <FileText className="size-4" aria-hidden="true" /> Invoice
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEmailDialog(r)}>
                      <Send className="size-4" aria-hidden="true" /> Email
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : previewError ? (
          <InlineErrorBanner message={previewError} onRetry={fetchPreview} />
        ) : isLoadingPreview ? (
          <ul className="space-y-2" aria-label="Loading sessions">
            {[0, 1].map((i) => (
              <li key={i}>
                <Skeleton className="h-[72px] w-full" />
              </li>
            ))}
          </ul>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            heading="Nothing to generate"
            subtext="Sessions you've logged will show up here, ready to turn into a SEVF."
          />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink-muted">
                {selectedGroupKeys.size} SEVF{selectedGroupKeys.size === 1 ? "" : "s"} will be generated ({selectedIds.size} session{selectedIds.size === 1 ? "" : "s"} selected)
              </p>
              <button type="button" onClick={toggleSelectAll} className="press-scale text-sm font-semibold text-primary">
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <ul role="list" className="space-y-2">
              {sessions.map((s) => {
                const isSelected = selectedIds.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      onClick={() => toggleSession(s.id)}
                      className={cn(
                        "press-scale flex w-full items-center gap-3 rounded-card border p-3.5 text-left shadow-[var(--elev-rest)]",
                        isSelected ? "border-primary bg-primary-tint" : "border-border bg-surface"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-[6px] border-2",
                          isSelected ? "border-primary bg-primary" : "border-border bg-transparent"
                        )}
                        aria-hidden="true"
                      >
                        {isSelected && <Check className="size-3.5 text-primary-fg" />}
                      </span>
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
                        <FileText className="size-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-ink">{s.patientName}</p>
                        <p className="text-xs text-ink-muted">
                          {s.companyAffiliation || "No agency"} · {formatSafeDate(s.serviceDate)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button className="mt-5 w-full" onClick={handleGenerate} disabled={isGenerating || selectedIds.size === 0}>
              {isGenerating
                ? "Generating…"
                : `Generate ${selectedGroupKeys.size} SEVF${selectedGroupKeys.size === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </div>

      <Dialog open={!!emailTarget} onOpenChange={(open) => !open && setEmailTarget(null)}>
        <DialogContent aria-labelledby="email-sevf-dialog-title">
          <DialogHeader>
            <DialogTitle id="email-sevf-dialog-title">Email SEVF to agency</DialogTitle>
            <DialogDescription>
              Send {emailTarget?.patientName}'s SEVF{emailTarget?.invoiceDownloadUrl ? " and invoice" : ""} ({emailTarget?.month}) directly to the agency's email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="agencyEmail" className="text-xs">Agency email</Label>
            <Input
              id="agencyEmail"
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
