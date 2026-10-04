import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronDown, Video } from "lucide-react";
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
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Picker } from "@/components/Picker";
import { ChipPicker } from "@/components/ChipPicker";
import { CompanyAffiliationField } from "@/components/CompanyAffiliationField";
import { SignatureCapture } from "@/components/SignatureCapture";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TelepracticeSentDialog } from "@/components/TelepracticeSentDialog";
import { ParentEmailPromptDialog } from "@/components/ParentEmailPromptDialog";
import { DuplicateLogDialog } from "@/components/DuplicateLogDialog";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { calculateTotalMinutes, localTodayIso, localNowHHMM, addMinutesToTime } from "@/utils/time";
import { cn } from "@/lib/utils";
import type { Agency, ApiErrorBody, SessionDraft } from "@/types";

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
  /** Independent-practitioner-only — which agency this session is billed
   *  to (see CompanyAffiliationField). Ignored/unused for a tenant
   *  practitioner, whose form never renders this field. */
  companyAffiliation: string;
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
  const { patients, profile, setSavedSignature, serviceTypeOptions, statusOptions, locationOptions, groupSizeOptions, dropdownOptions, dropdownCategories, agencies, fetchAgencies } = useAppData();
  const { practitioner, isIndependentPractitioner } = useAuth();
  const { showToast } = useToast();

  const patient = patients.find((p) => p.id === patientId);

  // This patient's own roster of agencies (0..N) — shown as fast-tap chips
  // on CompanyAffiliationField above the full agency list. See
  // AddPatient.tsx/EditPatient.tsx for where the roster itself is set.
  const [rosterAgencies, setRosterAgencies] = React.useState<Agency[]>([]);

  React.useEffect(() => {
    if (!isIndependentPractitioner || !patientId) return;
    api
      .get<{ success: boolean; agencies: Agency[] }>(`/api/patients/${patientId}/agencies`)
      .then((res) => {
        const roster = res.data.agencies || [];
        setRosterAgencies(roster);
        // Auto-pick when there's exactly one agency on this child's roster
        // and the field hasn't been set some other way yet (resuming a
        // draft, or a fresh/new-patient default already present) — a child
        // billed to more than one agency still requires a deliberate choice.
        if (roster.length === 1) {
          setForm((f) => (f.companyAffiliation ? f : { ...f, companyAffiliation: roster[0].name }));
        }
      })
      .catch(() => {
        // Non-critical — the field just falls back to no pinned chips,
        // still fully usable via the full agency list/"Add new agency".
      });
  }, [isIndependentPractitioner, patientId]);

  // Pre-fills Status/Service Type/Location/Group Size from this same
  // child's own most recent log (see patientController.js's
  // getLastSessionDefaults) — a given child's usual service details repeat
  // session to session far more often than they change, so starting every
  // field blank every time is pure repeated tapping. Skipped entirely when
  // resuming a saved draft (draftId set) — that draft's own saved values
  // take priority and must never be silently overwritten by "last session"
  // data once the draft-loading effect above runs.
  React.useEffect(() => {
    if (draftId || !patientId) return;
    api
      .get<{
        success: boolean;
        defaults: {
          status: string | null; type: string | null; location: string | null;
          groupSizeCategory: string | null; companyAffiliation: string | null;
        } | null;
      }>(`/api/patients/${patientId}/last-session-defaults`)
      .then((res) => {
        const d = res.data.defaults;
        if (!d) return;
        setForm((f) => ({
          ...f,
          status: f.status || d.status || f.status,
          type: f.type || d.type || f.type,
          location: f.location || d.location || f.location,
          groupSizeCategory: f.groupSizeCategory || d.groupSizeCategory || f.groupSizeCategory,
        }));
      })
      .catch(() => {
        // Non-critical — every field just starts blank, same as before this existed.
      });
  }, [draftId, patientId]);

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
    companyAffiliation: patient?.last_company_affiliation || "",
  });
  const [zeroTime, setZeroTime] = React.useState(false);
  const [isTelepractice, setIsTelepractice] = React.useState(false);
  const [parentEmailPromptOpen, setParentEmailPromptOpen] = React.useState(false);
  const [parentSig, setParentSig] = React.useState<string | null>(null);
  const [practitionerSig, setPractitionerSig] = React.useState<string | null>(null);
  const [isUsingSaved, setIsUsingSaved] = React.useState(false);
  const [saveAsDefault, setSaveAsDefault] = React.useState(false);

  const [touched, setTouched] = React.useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [duplicateMessage, setDuplicateMessage] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [telepracticeSentOpen, setTelepracticeSentOpen] = React.useState(false);
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
          companyAffiliation: saved.companyAffiliation ?? f.companyAffiliation,
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
  if (isIndependentPractitioner && !form.companyAffiliation) missing.push("agency");
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

  // Details + Codes are the fields almost every session needs filled in
  // order; Notes is optional and Signatures is the only other hard
  // requirement. Once both are complete, auto-advance straight to
  // Signatures (skipping the optional Notes tap/scroll a practitioner would
  // otherwise have to pass through every single time) — fires once per
  // screen visit (hasAutoAdvanced guards against re-firing on every
  // keystroke once already complete, and against overriding a section the
  // practitioner deliberately navigated to themselves afterward).
  const detailsAndCodesComplete =
    !!form.date &&
    (zeroTime || (!!form.startTime && !!form.endTime)) &&
    !!form.type &&
    !!form.status &&
    !!form.location &&
    (!isIndependentPractitioner || !!form.companyAffiliation) &&
    customCategories.every((cat) => !cat.is_required_on_log || !!form.customFields[cat.key]);
  const hasAutoAdvanced = React.useRef(false);

  React.useEffect(() => {
    if (hasAutoAdvanced.current) return;
    if (detailsAndCodesComplete && activeSection === "codes") {
      hasAutoAdvanced.current = true;
      scrollToSection("signatures");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsAndCodesComplete, activeSection]);

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
      scrollToSection(!form.date || !form.startTime || !form.endTime ? "details" : !form.type || !form.status || !form.location || (isIndependentPractitioner && !form.companyAffiliation) ? "codes" : "signatures");
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
        companyAffiliation: isIndependentPractitioner ? form.companyAffiliation : undefined,
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

      if (isTelepractice) {
        // A centered dialog, not a toast — this means the session is still
        // awaiting the parent's signature, not fully logged, so the
        // practitioner needs to actually read it. Navigation happens once
        // they dismiss it, not immediately.
        setTelepracticeSentOpen(true);
      } else {
        showToast("Session saved.");
        navigate(`/patients/${patientId}`, { replace: true });
      }
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      if (body?.code === "DUPLICATE_LOG") {
        // A hard block, not a fixable field error — surface it as a centered
        // dialog the practitioner has to acknowledge, not the inline banner.
        setDuplicateMessage(body.error || null);
      } else {
        setServerError(body?.error || "There was an error saving the session. Your entries have been kept.");
      }
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
        {/* Deliberately louder than a routine checkbox row — this single
            toggle branches the whole form's signature flow, so it needs to
            be caught before a practitioner fills everything else in. */}
        <label className="flex items-start gap-3 rounded-card border-2 border-primary/50 bg-primary-tint px-3.5 py-3">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 rounded border-2 border-primary accent-primary"
            checked={isTelepractice}
            onChange={(e) => {
              const checked = e.target.checked;
              setIsTelepractice(checked);
              setTouched(true);
              // Prompt for the parent email right here instead of only
              // surfacing it later in the Signatures section — catches the
              // blocker the moment it becomes relevant, not several fields
              // into the form.
              if (checked && !patient?.parent_email) setParentEmailPromptOpen(true);
            }}
          />
          <span>
            <span className="flex items-center gap-1.5 text-[14px] font-bold text-primary">
              <Video className="size-4 shrink-0" aria-hidden="true" />
              Telepractice (Video) Session
            </span>
            <span className="mt-0.5 block text-xs font-medium text-ink-body">
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
          {!zeroTime && (
            <div className="flex flex-wrap gap-2">
              {/* One tap instead of opening the native time picker — covers
                  the common case of logging a session as it starts/ends.
                  Still fully editable via the fields above either way. */}
              <button
                type="button"
                onClick={() => setField("startTime", localNowHHMM())}
                className="press-scale min-h-[36px] rounded-full border border-border-strong bg-surface px-3.5 text-xs font-semibold text-ink"
              >
                Start now
              </button>
              {[15, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  disabled={!form.startTime}
                  onClick={() => setField("endTime", addMinutesToTime(form.startTime, mins))}
                  className="press-scale min-h-[36px] rounded-full border border-border-strong bg-surface px-3.5 text-xs font-semibold text-ink disabled:opacity-40"
                >
                  {mins} min
                </button>
              ))}
            </div>
          )}
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
          <ChipPicker
            id="status"
            label="Status"
            value={form.status}
            options={statusOptions}
            onChange={(v) => setField("status", v)}
            error={attemptedSubmit && !form.status ? "Status is required." : null}
          />
          <ChipPicker
            id="location"
            label="Location"
            value={form.location}
            options={locationOptions}
            onChange={(v) => setField("location", v)}
            error={attemptedSubmit && !form.location ? "Location is required." : null}
          />
          <ChipPicker
            id="groupSizeCategory"
            label="Group size category"
            value={form.groupSizeCategory}
            options={groupSizeOptions}
            onChange={(v) => setField("groupSizeCategory", v)}
          />
          {isIndependentPractitioner && (
            <CompanyAffiliationField
              value={form.companyAffiliation}
              onChange={(v) => setField("companyAffiliation", v)}
              agencies={agencies}
              rosterAgencies={rosterAgencies}
              onAgencyCreated={fetchAgencies}
              error={attemptedSubmit && !form.companyAffiliation ? "An agency is required." : null}
            />
          )}
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
                    Add a parent email on this child&apos;s Edit screen before submitting a telepractice session.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate(`/patients/${patientId}/edit`)}
                    className="press-scale mt-2 text-sm font-semibold text-danger underline"
                  >
                    Edit child
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
        <div className="flex">
          {/* Split button: the primary action gets the full row (so its
              label — "Save Session" or, for telepractice, the much longer
              "Send to Parent to Sign" — always has room to breathe or wrap),
              with Save Draft / Cancel tucked behind the chevron instead of
              fighting it for space in an even three-way split. */}
          <Button
            className="h-auto min-h-12 flex-1 whitespace-normal rounded-r-none py-2 text-center leading-tight"
            size="lg"
            onClick={handleSubmit}
            loading={submitting}
            disabled={submitting || savingDraft}
          >
            {isTelepractice ? "Send to Parent to Sign" : "Save Session"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="lg"
                aria-label="More options: Save Draft or Cancel"
                disabled={submitting || savingDraft}
                className="w-12 shrink-0 rounded-l-none border-l border-l-primary-hover px-0"
              >
                <ChevronDown className="size-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end">
              <DropdownMenuItem onSelect={() => handleSaveDraft()} disabled={submitting || savingDraft}>
                {savingDraft ? "Saving Draft..." : "Save Draft"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleBack} disabled={submitting || savingDraft}>
                Cancel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this session?"
        description="You have unsaved details or a captured signature. Leaving now will discard them."
        confirmLabel="Discard"
        destructive
        onConfirm={() => navigate(-1)}
      />

      {patient && (
        <ParentEmailPromptDialog
          open={parentEmailPromptOpen}
          onOpenChange={(open) => {
            setParentEmailPromptOpen(open);
            // Reached only via Cancel / outside-click / Escape — a successful
            // save closes through onSaved below instead, which leaves
            // telepractice checked rather than reverting it.
            if (!open) setIsTelepractice(false);
          }}
          patient={patient}
          onSaved={() => {
            setParentEmailPromptOpen(false);
            showToast("Parent email saved.");
          }}
        />
      )}

      <DuplicateLogDialog
        open={duplicateMessage !== null}
        onOpenChange={(open) => { if (!open) setDuplicateMessage(null); }}
        message={duplicateMessage || undefined}
      />

      <TelepracticeSentDialog
        open={telepracticeSentOpen}
        onOpenChange={(open) => {
          setTelepracticeSentOpen(open);
          if (!open) navigate(`/patients/${patientId}`, { replace: true });
        }}
        parentEmail={patient?.parent_email}
      />
    </PushScreen>
  );
}
