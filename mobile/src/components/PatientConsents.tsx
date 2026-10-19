import * as React from "react";
import { ShieldCheck, Plus } from "lucide-react";
import api from "@/api/axiosInstance";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import type { RecordsConsent, RecordType, ApiErrorBody } from "@/types";

const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  session_logs: "Session logs",
  sevf_forms: "SEVF forms",
  invoices: "Invoices",
  full_record_export: "Full record export",
};

function consentStatus(c: RecordsConsent): "Active" | "Revoked" | "Expired" {
  if (c.revoked_at) return "Revoked";
  if (new Date(c.expires_at) <= new Date()) return "Expired";
  return "Active";
}

interface PatientConsentsProps {
  // string, matching Patient.id's type (mobile/src/types/index.ts) — the
  // caller (PatientDetail.tsx) has a Patient, not a GeneratedSevfResult
  // (whose patientId is a number), so this takes the same type its one
  // real caller already has, instead of forcing a conversion.
  patientId: string;
}

// FERPA/IDEA Part C §99.30 & §303.414 — before emailing a child's SEVF to a
// billing agency (see SevfHistory.tsx), a matching, active consent must be
// on file here or the backend refuses the send. Staff-logged only: a
// practitioner records that a parent gave consent (verbally, on paper, or
// some other out-of-band means), not a parent-facing self-service flow.
export function PatientConsents({ patientId }: PatientConsentsProps) {
  const { showToast } = useToast();
  const [consents, setConsents] = React.useState<RecordsConsent[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [formOpen, setFormOpen] = React.useState(false);
  const [recipientName, setRecipientName] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [selectedTypes, setSelectedTypes] = React.useState<RecordType[]>([]);
  const [proofNote, setProofNote] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<RecordsConsent | null>(null);
  const [isRevoking, setIsRevoking] = React.useState(false);

  const fetchConsents = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ success: boolean; consents: RecordsConsent[] }>(
        `/api/patients/${patientId}/consents`
      );
      setConsents(res.data.consents || []);
    } catch {
      showToast("Couldn't load consents.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [patientId, showToast]);

  React.useEffect(() => {
    fetchConsents();
  }, [fetchConsents]);

  const toggleType = (t: RecordType) => {
    setSelectedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const resetForm = () => {
    setRecipientName("");
    setPurpose("");
    setSelectedTypes([]);
    setProofNote("");
  };

  const commitNew = async () => {
    if (!recipientName.trim() || !purpose.trim() || selectedTypes.length === 0) return;
    setIsSaving(true);
    try {
      await api.post(`/api/patients/${patientId}/consents`, {
        recipientName: recipientName.trim(),
        purpose: purpose.trim(),
        recordTypes: selectedTypes,
        proofNote: proofNote.trim() || undefined,
      });
      setFormOpen(false);
      resetForm();
      fetchConsents();
      showToast("Consent logged.", "success");
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't log this consent.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const commitRevoke = async () => {
    if (!revokeTarget) return;
    setIsRevoking(true);
    try {
      await api.delete(`/api/patients/${patientId}/consents/${revokeTarget.id}`);
      setRevokeTarget(null);
      fetchConsents();
      showToast("Consent revoked.", "success");
    } catch {
      showToast("Couldn't revoke this consent.", "error");
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Consents
        </h3>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="press-scale flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-3 py-1 text-xs font-semibold text-primary"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Log consent
        </button>
      </div>

      {isLoading ? (
        <p className="mt-2 text-xs text-ink-muted">Loading…</p>
      ) : consents.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">No consents on file for this child yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {consents.map((c) => {
            const status = consentStatus(c);
            return (
              <li key={c.id} className="rounded-control border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">{c.recipient_name}</span>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                      (status === "Active"
                        ? "bg-emerald-50 text-emerald-700"
                        : status === "Expired"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-500")
                    }
                  >
                    {status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">{c.purpose}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {c.record_types.map((t) => RECORD_TYPE_LABELS[t]).join(", ")}
                </p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  Granted {new Date(c.granted_at).toLocaleDateString()} · Expires {new Date(c.expires_at).toLocaleDateString()}
                </p>
                {status === "Active" && (
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(c)}
                    className="press-scale mt-2 text-xs font-semibold text-red-600"
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent aria-labelledby="log-consent-title">
          <SheetHeader>
            <SheetTitle id="log-consent-title">Log a new consent</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="consent-recipient">Recipient</Label>
            <Input
              id="consent-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="e.g. ABC Billing Agency"
              disabled={isSaving}
            />
            <Label htmlFor="consent-purpose">Purpose</Label>
            <Input
              id="consent-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Billing for early intervention services"
              disabled={isSaving}
            />
            <Label>Records covered</Label>
            <div className="space-y-1.5">
              {(Object.keys(RECORD_TYPE_LABELS) as RecordType[]).map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(t)}
                    onChange={() => toggleType(t)}
                    disabled={isSaving}
                  />
                  {RECORD_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
            <Label htmlFor="consent-proof">Proof note (optional)</Label>
            <Input
              id="consent-proof"
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder="e.g. Signed paper form on file"
              disabled={isSaving}
            />
            <p className="text-xs text-ink-muted">Expires one year from today unless revoked sooner.</p>
            <Button
              className="w-full"
              onClick={commitNew}
              disabled={!recipientName.trim() || !purpose.trim() || selectedTypes.length === 0}
              loading={isSaving}
            >
              Save consent
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this consent?"
        description={revokeTarget ? `Future disclosures to "${revokeTarget.recipient_name}" will be blocked immediately.` : ""}
        confirmLabel="Revoke"
        destructive
        onConfirm={commitRevoke}
        loading={isRevoking}
      />
    </div>
  );
}
