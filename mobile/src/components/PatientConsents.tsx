import * as React from "react";
import { ShieldCheck, Plus, Send } from "lucide-react";
import api from "@/api/axiosInstance";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { RecordsConsent, RecordType, ApiErrorBody, ConsentRequest } from "@/types";

const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  session_logs: "Session logs",
  sevf_forms: "SEVF forms",
  invoices: "Invoices",
  full_record_export: "Full record export",
};

const IDENTITY_METHOD_LABELS: Record<string, string> = {
  known_parent: "Known parent/guardian",
  photo_id: "Photo ID checked",
  callback_verified: "Verified by callback",
  in_person: "Verified in person",
  electronic_dob: "Parent signed electronically (date of birth confirmed)",
  other: "Other",
};

function consentStatus(c: RecordsConsent): "Active" | "Revoked" | "Expired" {
  if (c.revoked_at) return "Revoked";
  if (new Date(c.expires_at) <= new Date()) return "Expired";
  return "Active";
}

const SELECTABLE_IDENTITY_METHODS = Object.entries(IDENTITY_METHOD_LABELS).filter(
  ([k]) => k !== "electronic_dob"
);

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Dates arrive as 'YYYY-MM-DD' or full ISO; show date-only values without
// timezone shifting.
function fmtDate(v: string | null | undefined): string {
  if (!v) return "unknown";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleDateString();
}

function defaultExpiresAt(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
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
  const [recipientEmail, setRecipientEmail] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [selectedTypes, setSelectedTypes] = React.useState<RecordType[]>([]);
  const [expiresAt, setExpiresAt] = React.useState(defaultExpiresAt());
  const [proofNote, setProofNote] = React.useState("");
  const [identityMethod, setIdentityMethod] = React.useState("");
  const [identityNote, setIdentityNote] = React.useState("");
  const [showValidation, setShowValidation] = React.useState(false);
  const [signedOn, setSignedOn] = React.useState("");
  const [paperAttested, setPaperAttested] = React.useState(false);
  const [requests, setRequests] = React.useState<ConsentRequest[]>([]);
  const [reqOpen, setReqOpen] = React.useState(false);
  const [reqShowValidation, setReqShowValidation] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [notice, setNotice] = React.useState<{ title: string; message: string } | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<ConsentRequest | null>(null);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [resendingId, setResendingId] = React.useState<number | null>(null);
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

  const fetchRequests = React.useCallback(async () => {
    try {
      const res = await api.get<{ requests: ConsentRequest[] }>(`/api/patients/${patientId}/consent-requests`);
      setRequests(res.data.requests || []);
    } catch {
      // Non-fatal: the awaiting list simply stays as-is.
    }
  }, [patientId]);

  React.useEffect(() => {
    fetchConsents();
    fetchRequests();
  }, [fetchConsents, fetchRequests]);

  // Arriving from the SEVF "consent required" dialog (#consents).
  React.useEffect(() => {
    if (!isLoading && window.location.hash === "#consents") {
      document.getElementById("consents")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isLoading]);

  const errMsg = (err: unknown, fallback: string) =>
    (err as { response?: { data?: ApiErrorBody } }).response?.data?.error || fallback;

  const toggleType = (t: RecordType) => {
    setSelectedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const resetForm = () => {
    setRecipientName("");
    setRecipientEmail("");
    setPurpose("");
    setSelectedTypes([]);
    setExpiresAt(defaultExpiresAt());
    setProofNote("");
    setIdentityMethod("");
    setIdentityNote("");
    setShowValidation(false);
    setSignedOn("");
    setPaperAttested(false);
    setReqShowValidation(false);
  };

  const commitRequest = async () => {
    if (!recipientName.trim() || !purpose.trim() || selectedTypes.length === 0 || !expiresAt) {
      setReqShowValidation(true);
      return;
    }
    setIsSending(true);
    try {
      await api.post(`/api/patients/${patientId}/consent-requests`, {
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim() || undefined,
        purpose: purpose.trim(),
        recordTypes: selectedTypes,
        expiresAt: new Date(expiresAt).toISOString(),
      });
      setReqOpen(false);
      resetForm();
      fetchRequests();
      setNotice({ title: "Request sent", message: "We emailed the parent a private link to review and sign." });
    } catch (err) {
      setNotice({ title: "Couldn't send the request", message: errMsg(err, "Something went wrong. Please try again.") });
    } finally {
      setIsSending(false);
    }
  };

  const resend = async (r: ConsentRequest) => {
    setResendingId(r.id);
    try {
      await api.post(`/api/patients/${patientId}/consent-requests/${r.id}/resend`);
      fetchRequests();
      setNotice({ title: "Request resent", message: "We emailed the parent a fresh private link." });
    } catch (err) {
      setNotice({ title: "Couldn't resend", message: errMsg(err, "Something went wrong. Please try again.") });
    } finally {
      setResendingId(null);
    }
  };

  const commitCancel = async () => {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      await api.delete(`/api/patients/${patientId}/consent-requests/${cancelTarget.id}`);
      setCancelTarget(null);
      fetchRequests();
    } catch (err) {
      setCancelTarget(null);
      setNotice({ title: "Couldn't cancel", message: errMsg(err, "Something went wrong. Please try again.") });
    } finally {
      setIsCancelling(false);
    }
  };

  const commitNew = async () => {
    if (!recipientName.trim() || !purpose.trim() || selectedTypes.length === 0) return;
    if (
      !identityMethod ||
      (identityMethod === "other" && !identityNote.trim()) ||
      !signedOn ||
      signedOn > todayStr() ||
      !paperAttested
    ) {
      setShowValidation(true);
      return;
    }
    setIsSaving(true);
    try {
      await api.post(`/api/patients/${patientId}/consents`, {
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim() || undefined,
        purpose: purpose.trim(),
        recordTypes: selectedTypes,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        proofNote: proofNote.trim() || undefined,
        identityVerifiedMethod: identityMethod,
        identityVerifiedNote: identityNote.trim() || undefined,
        signedOn,
        paperAttested: true,
      });
      setFormOpen(false);
      resetForm();
      fetchConsents();
      showToast("Paper consent recorded.", "success");
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setNotice({ title: "Couldn't record this consent", message: body?.error || "Something went wrong. Please try again." });
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
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { resetForm(); setReqOpen(true); }}
          className="press-scale flex items-center gap-1 rounded-full border border-primary bg-primary/5 px-3 py-1 text-xs font-semibold text-primary"
        >
          <Send className="size-3.5" aria-hidden="true" /> Request parent signature
        </button>
        <button
          type="button"
          onClick={() => { resetForm(); setFormOpen(true); }}
          className="press-scale flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-3 py-1 text-xs font-semibold text-primary"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Record paper consent
        </button>
      </div>

      {requests.some((r) => r.status === "pending" || r.status === "expired") && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-ink">Awaiting parent signature</h4>
          <ul className="mt-1.5 space-y-2">
            {requests
              .filter((r) => r.status === "pending" || r.status === "expired")
              .map((r) => (
                <li key={r.id} className="rounded-control border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink">{r.recipientName}</span>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                        (r.status === "pending" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700")
                      }
                    >
                      {r.status === "pending" ? "Awaiting signature" : "Link expired"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{r.purpose}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {r.recordTypes.map((t) => RECORD_TYPE_LABELS[t]).join(", ")}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Sent {fmtDate(r.requestedAt ?? r.createdAt)} · Link {r.status === "pending" ? "expires" : "expired"}{" "}
                    {fmtDate(r.requestExpiresAt)}
                  </p>
                  <div className="mt-2 flex gap-4">
                    <button
                      type="button"
                      onClick={() => resend(r)}
                      disabled={resendingId === r.id}
                      className="press-scale text-xs font-semibold text-primary disabled:opacity-50"
                    >
                      {resendingId === r.id ? "Resending…" : "Resend"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelTarget(r)}
                      className="press-scale text-xs font-semibold text-red-600"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}

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
                  <span className="flex items-center gap-1.5">
                  {c.source && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {c.source === "paper" ? "Paper" : "Electronic"}
                    </span>
                  )}
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
                  </span>
                </div>
                {c.recipient_email && <p className="mt-0.5 text-xs text-ink-muted">{c.recipient_email}</p>}
                <p className="mt-1 text-xs text-ink-muted">{c.purpose}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {c.record_types.map((t) => RECORD_TYPE_LABELS[t]).join(", ")}
                </p>
                {c.identity_verified_method && (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Identity: {IDENTITY_METHOD_LABELS[c.identity_verified_method] || c.identity_verified_method}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-ink-muted">
                  {c.source === "paper" && c.signed_on
                    ? `Signed on paper ${fmtDate(c.signed_on)}`
                    : c.source === "electronic"
                    ? `Signed electronically ${fmtDate(c.granted_at)}${c.signed_name ? ` by ${c.signed_name}` : ""}`
                    : `Granted ${new Date(c.granted_at).toLocaleDateString()}`}{" "}
                  · Expires {new Date(c.expires_at).toLocaleDateString()}
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
            <SheetTitle id="log-consent-title">Record paper consent</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-ink-muted">Use this when you already have a signed paper consent on file.</p>
            <Label htmlFor="consent-recipient">Recipient</Label>
            <Input
              id="consent-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="e.g. ABC Billing Agency"
              disabled={isSaving}
            />
            <Label htmlFor="consent-recipient-email">Recipient email (optional)</Label>
            <Input
              id="consent-recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="e.g. billing@abcagency.org"
              disabled={isSaving}
            />
            <p className="text-xs text-ink-muted">
              If this consent is for emailing records to the recipient, enter the exact address you'll send to — a
              send is only allowed when it matches.
            </p>
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
            <Label htmlFor="consent-expires">Expires</Label>
            <Input
              id="consent-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              disabled={isSaving}
            />
            <p className="text-xs text-ink-muted">Defaults to one year from today — shorten this for a one-off disclosure.</p>
            <Label htmlFor="consent-proof">Proof note (optional)</Label>
            <Input
              id="consent-proof"
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder="e.g. Signed paper form on file"
              disabled={isSaving}
            />
            <Label htmlFor="consent-identity">How was the parent/guardian's identity verified?</Label>
            <select
              id="consent-identity"
              value={identityMethod}
              onChange={(e) => setIdentityMethod(e.target.value)}
              disabled={isSaving}
              aria-invalid={showValidation && !identityMethod}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-ink"
            >
              <option value="">Select a method…</option>
              {SELECTABLE_IDENTITY_METHODS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {showValidation && !identityMethod && (
              <p role="alert" className="text-xs font-semibold text-red-600">
                Select how the consenting person's identity was verified.
              </p>
            )}
            {identityMethod === "other" && (
              <>
                <Label htmlFor="consent-identity-note">Describe how identity was verified</Label>
                <Input
                  id="consent-identity-note"
                  value={identityNote}
                  onChange={(e) => setIdentityNote(e.target.value)}
                  disabled={isSaving}
                />
                {showValidation && !identityNote.trim() && (
                  <p role="alert" className="text-xs font-semibold text-red-600">
                    A note is required when the method is "Other".
                  </p>
                )}
              </>
            )}
            <Label htmlFor="consent-signed-on">Date signed on paper</Label>
            <Input
              id="consent-signed-on"
              type="date"
              value={signedOn}
              onChange={(e) => setSignedOn(e.target.value)}
              max={todayStr()}
              disabled={isSaving}
              aria-invalid={showValidation && (!signedOn || signedOn > todayStr())}
            />
            {showValidation && (!signedOn || signedOn > todayStr()) && (
              <p role="alert" className="text-xs font-semibold text-red-600">
                Enter the date on the paper form (today or earlier).
              </p>
            )}
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={paperAttested}
                onChange={(e) => setPaperAttested(e.target.checked)}
                disabled={isSaving}
              />
              A signed paper consent is on file
            </label>
            {showValidation && !paperAttested && (
              <p role="alert" className="text-xs font-semibold text-red-600">
                Confirm that a signed paper consent is on file.
              </p>
            )}
            <Button
              className="w-full"
              onClick={commitNew}
              disabled={!recipientName.trim() || !purpose.trim() || selectedTypes.length === 0}
              loading={isSaving}
            >
              Save paper consent
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={reqOpen} onOpenChange={setReqOpen}>
        <SheetContent aria-labelledby="request-consent-title">
          <SheetHeader>
            <SheetTitle id="request-consent-title">Request parent signature</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-ink-muted">
              We email the parent a private link to review and sign. Nothing about the child is in the email.
            </p>
            <Label htmlFor="req-recipient">Recipient</Label>
            <Input
              id="req-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="e.g. ABC Billing Agency"
              disabled={isSending}
              aria-invalid={reqShowValidation && !recipientName.trim()}
            />
            <Label htmlFor="req-recipient-email">Recipient email (optional)</Label>
            <Input
              id="req-recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="e.g. billing@abcagency.org"
              disabled={isSending}
            />
            <Label htmlFor="req-purpose">Purpose</Label>
            <Input
              id="req-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Billing for early intervention services"
              disabled={isSending}
              aria-invalid={reqShowValidation && !purpose.trim()}
            />
            <Label>Records covered</Label>
            <div className="space-y-1.5">
              {(Object.keys(RECORD_TYPE_LABELS) as RecordType[]).map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={selectedTypes.includes(t)} onChange={() => toggleType(t)} disabled={isSending} />
                  {RECORD_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
            <Label htmlFor="req-expires">Consent expires</Label>
            <Input
              id="req-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              disabled={isSending}
            />
            {reqShowValidation && (!recipientName.trim() || !purpose.trim() || selectedTypes.length === 0 || !expiresAt) && (
              <p role="alert" className="text-xs font-semibold text-red-600">
                Enter a recipient and purpose, pick at least one record type, and set an expiry date.
              </p>
            )}
            <Button className="w-full" onClick={commitRequest} loading={isSending}>
              Send request
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!notice} onOpenChange={(open) => !open && setNotice(null)}>
        <DialogContent aria-labelledby="consent-notice-title">
          <DialogHeader>
            <DialogTitle id="consent-notice-title">{notice?.title}</DialogTitle>
            <DialogDescription>{notice?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setNotice(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel this signature request?"
        description={cancelTarget ? `The link sent to the parent for "${cancelTarget.recipientName}" will stop working.` : ""}
        confirmLabel="Cancel request"
        destructive
        onConfirm={commitCancel}
        loading={isCancelling}
      />

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
