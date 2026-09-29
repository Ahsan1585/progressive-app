import * as React from "react";
import { FileText, Send, Printer, FolderOpen } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { SelfCertifiedSevfGroup, GeneratedSevfResult, ApiErrorBody } from "@/types";

// Independent-practitioner-only SEVF self-certification screen. Unlike the
// office Batch Review flow, there is no "pending review" state to show —
// a logged session is already self-certified and generation-eligible the
// moment it's submitted (see billingController.js's generateSelfCertifiedSEVF).
// This screen's only two states are "ready to generate" (the filtered
// preview below) and "generated" (the results list with print/email actions).
export default function GenerateSevf() {
  const { showToast } = useToast();
  const { patients } = useAppData();
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [companyAffiliation, setCompanyAffiliation] = React.useState("");

  // Same "recently used" source as LogIntervention.tsx's CompanyAffiliationField
  // — every distinct agency name across the practitioner's own patients, no
  // dedicated backend endpoint.
  const knownAffiliations = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of patients) {
      if (p.last_company_affiliation) set.add(p.last_company_affiliation);
    }
    return Array.from(set).sort();
  }, [patients]);

  const [groups, setGroups] = React.useState<SelfCertifiedSevfGroup[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(true);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const [isGenerating, setIsGenerating] = React.useState(false);
  const [results, setResults] = React.useState<GeneratedSevfResult[]>([]);

  const [emailTarget, setEmailTarget] = React.useState<GeneratedSevfResult | null>(null);
  const [agencyEmail, setAgencyEmail] = React.useState("");
  const [isSendingEmail, setIsSendingEmail] = React.useState(false);

  const fetchPreview = React.useCallback(async () => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (companyAffiliation.trim()) params.companyAffiliation = companyAffiliation.trim();
      const res = await api.get<{ success: boolean; groups: SelfCertifiedSevfGroup[] }>(
        "/api/billing/independent/pending",
        { params }
      );
      setGroups(res.data.groups || []);
    } catch {
      setPreviewError("Couldn't load your sessions.");
    } finally {
      setIsLoadingPreview(false);
    }
  }, [startDate, endDate, companyAffiliation]);

  React.useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const body: Record<string, string> = {};
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;
      if (companyAffiliation.trim()) body.companyAffiliation = companyAffiliation.trim();
      const res = await api.post<{ success: boolean; results: GeneratedSevfResult[]; message: string }>(
        "/api/billing/independent/generate-sevf",
        body
      );
      setResults(res.data.results || []);
      setGroups([]);
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

  const openEmailDialog = (result: GeneratedSevfResult) => {
    setEmailTarget(result);
    setAgencyEmail("");
  };

  const handleSendEmail = async () => {
    if (!emailTarget || !agencyEmail.trim()) return;
    setIsSendingEmail(true);
    try {
      await api.post("/api/billing/independent/email-sevf", {
        batchId: emailTarget.batchId,
        agencyEmail: agencyEmail.trim(),
      });
      showToast("SEVF emailed to the agency.", "success");
      setEmailTarget(null);
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't send the email. Please try again.", "error");
    } finally {
      setIsSendingEmail(false);
    }
  };

  const totalSessions = groups.reduce((sum, g) => sum + g.sessionCount, 0);

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
            <CompanyAffiliationFilter
              value={companyAffiliation}
              onChange={setCompanyAffiliation}
              knownAffiliations={knownAffiliations}
            />
          </div>
        )}

        {results.length > 0 ? (
          <>
            <p className="mb-3 text-[13px] font-semibold text-ink-muted">
              {results.length} SEVF{results.length === 1 ? "" : "s"} generated
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
                    <Button variant="outline" className="flex-1" onClick={() => handlePrint(r)}>
                      <Printer className="size-4" aria-hidden="true" /> Print
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={() => openEmailDialog(r)}>
                      <Send className="size-4" aria-hidden="true" /> Email to Agency
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
        ) : groups.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            heading="Nothing to generate"
            subtext="Sessions you've logged will show up here, ready to turn into a SEVF."
          />
        ) : (
          <>
            <p className="mb-3 text-[13px] font-semibold text-ink-muted">
              {groups.length} SEVF{groups.length === 1 ? "" : "s"} will be generated ({totalSessions} session{totalSessions === 1 ? "" : "s"})
            </p>
            <ul role="list" className="space-y-2">
              {groups.map((g) => (
                <li key={g.key} className={cn("flex items-center gap-3 rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]")}>
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
                    <FileText className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-ink">{g.patientName}</p>
                    <p className="text-xs text-ink-muted">
                      {g.companyAffiliation || "No agency"} · {g.month} · {g.sessionCount} session{g.sessionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <Button className="mt-5 w-full" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? "Generating…" : `Generate ${groups.length} SEVF${groups.length === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </div>

      <Dialog open={!!emailTarget} onOpenChange={(open) => !open && setEmailTarget(null)}>
        <DialogContent aria-labelledby="email-sevf-dialog-title">
          <DialogHeader>
            <DialogTitle id="email-sevf-dialog-title">Email SEVF to agency</DialogTitle>
            <DialogDescription>
              Send {emailTarget?.patientName}'s SEVF ({emailTarget?.month}) directly to the agency's email.
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
              autoFocus
            />
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
