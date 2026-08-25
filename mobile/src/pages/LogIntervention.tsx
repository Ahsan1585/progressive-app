import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/Picker";
import { SignatureCapture } from "@/components/SignatureCapture";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { calculateTotalMinutes, localTodayIso } from "@/utils/time";
import { cn } from "@/lib/utils";
import type { ApiErrorBody, SessionDraft } from "@/types";

interface FormState {
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  type: string;
  location: string;
  groupSizeCategory: string;
  customFields: Record<string, string>;
  note: string;
}

const todayIso = localTodayIso;

const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "codes", label: "Codes" },
  { id: "notes", label: "Notes" },
  { id: "signatures", label: "Signatures" },
] as const;

export default function LogIntervention() {
  const { id: patientId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // Only set when resuming a specific saved draft (from the Home or Patient
  // Detail draft lists) — tapping "Log Session" directly always starts
  // blank, since a child can now have up to 2 concurrent drafts and there's
  // no longer a single "the" draft to auto-resume.
  const draftId = searchParams.get("draftId");
  const navigate = useNavigate();
  const { patients, profile, setSavedSignature, serviceTypeOptions, statusOptions, locationOptions, groupSizeOptions, dropdownOptions, dropdownCategories } = useAppData();
  const { practitioner } = useAuth();
  const { showToast } = useToast();

  const patient = patients.find((p) => p.id === patientId);

  const customCategories = React.useMemo(
    () => dropdownCategories.filter((c) => c.is_custom && c.is_active),
    [dropdownCategories]
  );

  const allowedServiceTypeOptions = React.useMemo(() => {
    const allowed = profile?.service_types;
    if (!allowed || allowed.length === 0) return serviceTypeOptions;
    return serviceTypeOptions.filter((opt) => allowed.includes(opt.code));
  }, [profile, serviceTypeOptions]);

  const [form, setForm] = React.useState<FormState>({
    date: todayIso(),
    startTime: "",
    endTime: "",
    status: "",
    type: "",
    location: "",
    groupSizeCategory: "individual",
    customFields: {},
    note: "",
  });
  const [zeroTime, setZeroTime] = React.useState(false);
  const [isTelepractice, setIsTelepractice] = React.useState(false);
  const [parentSig, setParentSig] = React.useState<string | null>(null);
  const [practitionerSig, setPractitionerSig] = React.useState<string | null>(null);
  const [isUsingSaved, setIsUsingSaved] = React.useState(false);
  const [saveAsDefault, setSaveAsDefault] = React.useState(false);

  const [touched, setTouched] = React.useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState<string>("details");

  const sectionRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  // Only pre-fills when navigated here with a specific draftId (resuming a
  // saved draft from a list) — otherwise the form starts blank, even if this
  // child already has drafts saved. A fetch failure fails silently to a
  // blank form rather than blocking logging a fresh session over a
  // draft-loading problem.
  React.useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const res = await api.get<{ success: boolean; draft: SessionDraft | null }>(`/api/session-drafts/${draftId}`);
        const draft = res.data.draft;
        if (!draft) return;
        const saved = draft.formData as Partial<FormState> & { zeroTime?: boolean };
        setForm((f) => ({
          date: saved.date ?? f.date,
          startTime: saved.startTime ?? f.startTime,
          endTime: saved.endTime ?? f.endTime,
          status: saved.status ?? f.status,
          type: saved.type ?? f.type,
          location: saved.location ?? f.location,
          groupSizeCategory: saved.groupSizeCategory ?? f.groupSizeCategory,
          customFields: saved.customFields ?? f.customFields,
          note: saved.note ?? f.note,
        }));
        if (saved.zeroTime) setZeroTime(true);
        if (draft.parentSignatureBase64) setParentSig(draft.parentSignatureBase64);
        if (draft.practitionerSignatureBase64) setPractitionerSig(draft.practitionerSignatureBase64);
      } catch {
        // Fails silently — screen just shows a blank form, same as if no draft existed.
      }
    })();
  }, [draftId]);

  const totalMinutes = calculateTotalMinutes(form.startTime, form.endTime);

  const isDirty =
    touched ||
    !!parentSig ||
    !!practitionerSig ||
    form.startTime !== "" ||
    form.endTime !== "" ||
    form.status !== "" ||
    form.type !== "" ||
    form.location !== "";

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setTouched(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleZeroTimeToggle = (checked: boolean) => {
    setZeroTime(checked);
    setTouched(true);
    setForm((f) => ({ ...f, startTime: "", endTime: "" }));
  };

  const missing: string[] = [];
  if (!form.date) missing.push("date");
  if (!zeroTime && !form.startTime) missing.push("start time");
  if (!zeroTime && !form.endTime) missing.push("end time");
  if (!form.type) missing.push("service type");
  if (!form.status) missing.push("status");
  if (!form.location) missing.push("location");
  if (isTelepractice) {
    if (!patient?.parent_email) missing.push("parent email on file");
  } else if (!parentSig) {
    missing.push("parent signature");
  }
  if (!practitionerSig) missing.push("practitioner signature");
  for (const cat of customCategories) {
    if (cat.is_required_on_log && !form.customFields[cat.key]) missing.push(cat.display_name.toLowerCase());
  }

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleUseSavedSignature = () => {
    if (!profile?.signature) return;
    setPractitionerSig(profile.signature);
    setIsUsingSaved(true);
    setTouched(true);
  };

  const handlePractitionerSigChange = (value: string | null) => {
    setPractitionerSig(value);
    if (value === null) setIsUsingSaved(false);
    setTouched(true);
  };

  const handleBack = () => {
    if (isDirty) {
      setConfirmDiscard(true);
    } else {
      navigate(-1);
    }
  };

  const handleSubmit = async () => {
    setAttemptedSubmit(true);
    setServerError(null);
    if (missing.length > 0) {
      scrollToSection(!form.date || !form.startTime || !form.endTime ? "details" : !form.type || !form.status || !form.location ? "codes" : "signatures");
      return;
    }

    setSubmitting(true);
    try {
      if (!isUsingSaved && practitionerSig && saveAsDefault) {
        await api.post("/api/practitioner/signature", { signature: practitionerSig });
        setSavedSignature(practitionerSig);
      }

      const sharedPayload = {
        patientId: patient?.id,
        practitionerId: practitioner?.id,
        patient_first_name: patient?.middle_name ? `${patient.first_name} ${patient.middle_name}` : patient?.first_name,
        patient_last_name: patient?.last_name,
        patient_dob: patient?.dob,
        patient_county: patient?.county,
        practitioner_first_name: profile?.first_name || practitioner?.firstName,
        practitioner_last_name: profile?.last_name || practitioner?.lastName,
        practitioner_discipline: profile?.position_title || "Practitioner",
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        status: form.status,
        type: form.type,
        location: form.location,
        groupSizeCategory: form.groupSizeCategory,
        totalTime: totalMinutes,
        total_time: totalMinutes,
        practitionerSignatureBase64: practitionerSig,
        custom_fields: form.customFields,
        note: form.note,
      };

      if (isTelepractice) {
        await api.post("/api/telepractice-signatures", sharedPayload);
      } else {
        await api.post("/api/interventions", { ...sharedPayload, parentSignatureBase64: parentSig });
      }

      // The encounter is fully saved now — if this session was resumed from
      // a draft, that draft would otherwise linger as a stale, already-
      // submitted row silently eating one of the child's 2 draft slots.
      if (draftId) {
        try {
          await api.delete(`/api/session-drafts/${draftId}`);
        } catch {
          // Non-critical — the encounter itself is already saved successfully.
        }
      }

      showToast(
        isTelepractice
          ? `Sent to ${patient?.parent_email} — you'll see this in your Inbox once they sign.`
          : "Encounter saved."
      );
      navigate(`/patients/${patientId}`, { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setServerError(body?.error || "There was an error saving the encounter. Your entries have been kept.");
    } finally {
      setSubmitting(false);
    }
  };

  // Unlike Submit, this never validates — a draft can be as incomplete as
  // just a patient selected with nothing else filled in yet. Always
  // available regardless of how complete the form already is. Passing
  // draftId (when resuming an existing draft) updates it in place instead of
  // creating a second one; omitting it creates a new draft, subject to the
  // per-child cap enforced server-side.
  const handleSaveDraft = async () => {
    setServerError(null);
    setSavingDraft(true);
    try {
      await api.post("/api/session-drafts", {
        patientId: patient?.id,
        draftId: draftId || undefined,
        formData: { ...form, zeroTime },
        parentSignatureBase64: parentSig,
        practitionerSignatureBase64: practitionerSig,
      });
      showToast("Draft saved.");
      navigate(`/patients/${patientId}`, { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setServerError(body?.error || "There was an error saving the draft. Your entries have been kept.");
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Log Session" onBack={handleBack} />

      {patient && (
        <div className="border-b border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Logging session for</p>
          <p className="truncate text-[17px] font-semibold capitalize text-ink">
            {patient.first_name}
            {patient.middle_name ? ` ${patient.middle_name}` : ""} {patient.last_name}
          </p>
        </div>
      )}

      <div className="border-b border-border bg-surface px-4 py-3">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border-strong"
            checked={isTelepractice}
            onChange={(e) => { setIsTelepractice(e.target.checked); setTouched(true); }}
          />
          <span>
            <span className="block text-[13px] font-semibold text-ink">This was a telepractice (video) session</span>
            <span className="block text-xs text-ink-muted">
              We&apos;ll email the parent a link to review and sign remotely instead of collecting their signature here.
            </span>
          </span>
        </label>
      </div>

      {/* Sticky section-chip bar */}
      <div className="sticky top-14 z-20 flex gap-2 border-b border-border bg-bg px-4 py-2.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollToSection(s.id)}
            className={cn(
              "press-scale h-8 rounded-full border px-3.5 text-xs font-semibold",
              activeSection === s.id
                ? "border-transparent bg-primary text-primary-fg"
                : "border-border-strong bg-surface text-ink-muted"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto px-4 py-5 pb-28">
        {serverError && <InlineErrorBanner message={serverError} />}

        <div ref={(el) => { sectionRefs.current.details = el; }} className="space-y-4">
          <h2 className="text-[15px] font-semibold text-ink">Visit details</h2>
          <Field id="date" label="Service date" error={attemptedSubmit && !form.date ? "Date is required." : null}>
            <Input type="date" value={form.date} onChange={(e) => setField("date", e.target.value)} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="startTime" label="Start time" error={attemptedSubmit && !zeroTime && !form.startTime ? "Required." : null}>
              <Input type="time" value={form.startTime} onChange={(e) => setField("startTime", e.target.value)} disabled={zeroTime} required={!zeroTime} />
            </Field>
            <Field id="endTime" label="End time" error={attemptedSubmit && !zeroTime && !form.endTime ? "Required." : null}>
              <Input type="time" value={form.endTime} onChange={(e) => setField("endTime", e.target.value)} disabled={zeroTime} required={!zeroTime} />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-[13px] font-medium text-ink-body">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border-strong"
              checked={zeroTime}
              onChange={(e) => handleZeroTimeToggle(e.target.checked)}
            />
            Session was cancelled — log with 0 time
          </label>
          <div>
            <p className="text-[13px] font-medium leading-[18px] text-ink-body">Total time</p>
            <p className="tabular mt-1.5 text-lg font-semibold text-ink" aria-live="polite">
              {zeroTime ? "0 min (cancelled)" : totalMinutes > 0 ? `${(totalMinutes / 60).toFixed(2)} hrs (${totalMinutes} min)` : "—"}
            </p>
          </div>
        </div>

        <div ref={(el) => { sectionRefs.current.codes = el; }} className="space-y-4">
          <h2 className="text-[15px] font-semibold text-ink">Service codes</h2>
          <Picker
            id="type"
            label="Service type"
            value={form.type}
            options={allowedServiceTypeOptions}
            onChange={(v) => setField("type", v)}
            error={attemptedSubmit && !form.type ? "Service type is required." : null}
          />
          <Picker
            id="status"
            label="Status"
            value={form.status}
            options={statusOptions}
            onChange={(v) => setField("status", v)}
            error={attemptedSubmit && !form.status ? "Status is required." : null}
          />
          <Picker
            id="location"
            label="Location"
            value={form.location}
            options={locationOptions}
            onChange={(v) => setField("location", v)}
            error={attemptedSubmit && !form.location ? "Location is required." : null}
          />
          <Picker
            id="groupSizeCategory"
            label="Group size category"
            value={form.groupSizeCategory}
            options={groupSizeOptions}
            onChange={(v) => setField("groupSizeCategory", v)}
          />
          {customCategories.map((cat) => {
            const catOptions = (dropdownOptions[cat.key] || []).filter((o) => o.is_active);
            return (
              <Picker
                key={cat.key}
                id={`custom-${cat.key}`}
                label={cat.display_name}
                value={form.customFields[cat.key] || ""}
                options={catOptions}
                onChange={(v) => {
                  setTouched(true);
                  setForm((f) => ({ ...f, customFields: { ...f.customFields, [cat.key]: v } }));
                }}
                error={attemptedSubmit && cat.is_required_on_log && !form.customFields[cat.key] ? `${cat.display_name} is required.` : null}
              />
            );
          })}
        </div>

        <div ref={(el) => { sectionRefs.current.notes = el; }} className="space-y-4">
          <h2 className="text-[15px] font-semibold text-ink">Notes</h2>
          <Field id="note" label="Notes" optional>
            <Textarea
              placeholder="Add any context on this session..."
              value={form.note}
              onChange={(e) => setField("note", e.target.value)}
            />
          </Field>
        </div>

        <div ref={(el) => { sectionRefs.current.signatures = el; }} className="space-y-6">
          <h2 className="text-[15px] font-semibold text-ink">Signatures</h2>
          {isTelepractice ? (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-ink-body">Parent/caregiver signature</p>
              {patient?.parent_email ? (
                <div className="rounded-card border border-border bg-surface-sunken p-3.5">
                  <p className="text-sm text-ink-body">
                    We&apos;ll send a signing link to <span className="font-semibold text-ink">{patient.parent_email}</span> after you submit.
                  </p>
                </div>
              ) : (
                <div className="rounded-card border border-danger-border bg-danger-bg p-3.5">
                  <p className="text-sm font-semibold text-danger">No parent email on file</p>
                  <p className="mt-1 text-sm text-danger">
                    Add a parent email on this patient&apos;s Edit screen before submitting a telepractice session.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate(`/patients/${patientId}/edit`)}
                    className="press-scale mt-2 text-sm font-semibold text-danger underline"
                  >
                    Edit patient
                  </button>
                </div>
              )}
            </div>
          ) : (
            <SignatureCapture
              label="Parent/caregiver signature"
              instructions="Parent or caregiver signature — draw with your finger or stylus"
              value={parentSig}
              onChange={(v) => { setParentSig(v); setTouched(true); }}
              error={attemptedSubmit && !parentSig ? "Parent signature is required." : null}
            />
          )}
          <SignatureCapture
            label="Practitioner signature"
            instructions="Practitioner signature — draw with your finger or stylus"
            value={practitionerSig}
            onChange={handlePractitionerSigChange}
            savedSignature={profile?.signature}
            isUsingSaved={isUsingSaved}
            onUseSaved={handleUseSavedSignature}
            showSaveAsDefault
            saveAsDefault={saveAsDefault}
            onSaveAsDefaultChange={setSaveAsDefault}
            error={attemptedSubmit && !practitionerSig ? "Practitioner signature is required." : null}
          />
        </div>
      </div>

      {/* Sticky bottom submit bar with live "N missing" readout */}
      <div className="safe-bottom sticky bottom-0 z-20 border-t border-border bg-surface px-4 py-3 shadow-[var(--elev-raised)]">
        {missing.length > 0 && (
          <p className="tabular mb-2 text-xs font-medium text-ink-muted">
            {missing.length} field{missing.length > 1 ? "s" : ""} still missing
          </p>
        )}
        <div className="flex gap-3">
          <Button
            className="flex-1"
            size="lg"
            variant="outline"
            onClick={handleBack}
            disabled={submitting || savingDraft}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            size="lg"
            variant="outline"
            onClick={handleSaveDraft}
            loading={savingDraft}
            disabled={submitting || savingDraft}
          >
            Save Draft
          </Button>
          <Button className="flex-1" size="lg" onClick={handleSubmit} loading={submitting} disabled={submitting || savingDraft}>
            {isTelepractice ? "Send to Parent to Sign" : "Save encounter"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this encounter?"
        description="You have unsaved details or a captured signature. Leaving now will discard them."
        confirmLabel="Discard"
        destructive
        onConfirm={() => navigate(-1)}
      />
    </PushScreen>
  );
}
