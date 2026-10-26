import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MoreHorizontal, Users, Video } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { StepProgress } from "@/components/logSession/StepProgress";
import { CodeFields, NotesField, StepFooter, StepHeader, TimeFields, yesterdayIso } from "@/components/logSession/StepSections";
import { LOG_STEPS, stepMissing, firstIncompleteStep, videoLocationCode, type StepContext } from "@/utils/logSessionSteps";
import { CompanyAffiliationField } from "@/components/CompanyAffiliationField";
import { SignatureCapture } from "@/components/SignatureCapture";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TelepracticeSentDialog } from "@/components/TelepracticeSentDialog";
import { ParentEmailPromptDialog } from "@/components/ParentEmailPromptDialog";
import { DuplicateLogDialog } from "@/components/DuplicateLogDialog";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { calculateTotalMinutes, localTodayIso } from "@/utils/time";
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
        if (d.status || d.type || d.location) setPrefilledFromLast(true);
        lastSessionLocation.current = d.location || null;
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
  // Step-by-step flow: Details, Codes, Notes, Sign (see utils/logSessionSteps.ts).
  const [step, setStep] = React.useState(0);
  const [reached, setReached] = React.useState(0);
  const [triedNext, setTriedNext] = React.useState<boolean[]>([false, false, false, false]);
  const [prefilledFromLast, setPrefilledFromLast] = React.useState(false);
  const stepBodyRef = React.useRef<HTMLDivElement | null>(null);
  // Location before Video auto-picked the phone / video option, restored if they switch back to In person.
  const locationBeforeVideo = React.useRef<string | null>(null);
  const lastSessionLocation = React.useRef<string | null>(null);

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

  const stepCtx: StepContext = {
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
    zeroTime,
    type: form.type,
    status: form.status,
    location: form.location,
    customFields: form.customFields,
    requiredCustom: customCategories.filter((c) => c.is_required_on_log).map((c) => ({ key: c.key, label: c.display_name })),
    isIndependentPractitioner,
    companyAffiliation: form.companyAffiliation,
    isTelepractice,
    parentEmailOnFile: !!patient?.parent_email,
    parentSig,
    practitionerSig,
  };
  const stepComplete = LOG_STEPS.map((_, i) => stepMissing(i, stepCtx).length === 0);
  const currentMissing = stepMissing(step, stepCtx);
  const showErrors = attemptedSubmit || triedNext[step];

  const goToStep = (target: number) => {
    setStep(target);
    setReached((r) => Math.max(r, target));
    // scroll the new step to its top (guarded: not every webview implements Element.scrollTo)
    const body = stepBodyRef.current;
    if (body) { if (typeof body.scrollTo === "function") body.scrollTo({ top: 0 }); else body.scrollTop = 0; }
  };

  const handleNext = () => {
    if (currentMissing.length) {
      setTriedNext((t) => t.map((v, i) => (i === step ? true : v)));
      return;
    }
    goToStep(step + 1);
  };

  // Your saved signature is applied automatically on the Sign step (one less tap);
  // "Draw a new signature" in the pad still lets you sign by hand.
  React.useEffect(() => {
    if (step === 3 && !practitionerSig && profile?.signature) {
      setPractitionerSig(profile.signature);
      setIsUsingSaved(true);
    }
  }, [step, practitionerSig, profile?.signature]);

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
      const target = firstIncompleteStep(stepCtx);
      if (target >= 0) {
        setTriedNext((t) => t.map((v, i) => (i === target ? true : v)));
        goToStep(target);
      }
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

  const childName = patient ? `${patient.first_name}${patient.middle_name ? ` ${patient.middle_name}` : ""} ${patient.last_name}` : "";
  const initials = patient ? `${patient.first_name?.[0] ?? ""}${patient.last_name?.[0] ?? ""}` : "";
  const optionLabel = (opts: { code: string; label: string }[], code: string) => opts.find((o) => o.code === code)?.label || code;
  const fmt12 = (hm: string) => {
    if (!hm) return "";
    const [h, m] = hm.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  };
  const prettyDate = (iso: string) => {
    if (iso === todayIso()) return "Today";
    if (iso === yesterdayIso()) return "Yesterday";
    const [y, mo, d] = iso.split("-").map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };
  const errorFor = (key: string) => (showErrors && currentMissing.includes(key) ? true : false);

  const setTelepractice = (tele: boolean) => {
    setIsTelepractice(tele);
    setTouched(true);
    // A video session is a phone / video location, whatever last session used.
    // Only the location follows this choice; everything else stays as filled in.
    const videoCode = videoLocationCode(locationOptions);
    if (videoCode) {
      if (tele && form.location !== videoCode) {
        locationBeforeVideo.current = form.location;
        setForm((f) => ({ ...f, location: videoCode }));
      } else if (!tele && form.location === videoCode) {
        const restore = locationBeforeVideo.current || lastSessionLocation.current || "";
        locationBeforeVideo.current = null;
        setForm((f) => ({ ...f, location: restore === videoCode ? "" : restore }));
      }
    }
    // Prompt for the parent email right away, as before: catches the blocker
    // the moment it matters instead of on the last step.
    if (tele && !patient?.parent_email) setParentEmailPromptOpen(true);
  };

  return (
    <PushScreen>
      <AppBar
        title="Log Session"
        onBack={handleBack}
        trailing={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More options: Save Draft or Cancel" className="press-scale flex size-11 items-center justify-center rounded-control text-ink hover:bg-surface-sunken" disabled={submitting || savingDraft}>
                <MoreHorizontal className="size-6" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => handleSaveDraft()} disabled={submitting || savingDraft}>
                {savingDraft ? "Saving Draft..." : "Save Draft"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleBack} disabled={submitting || savingDraft}>
                Cancel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* who + where in the flow */}
      <div className="border-b border-border bg-surface px-4 pb-3.5 pt-3">
        {patient && (
          <div className="mb-3.5 flex items-center gap-3 rounded-[14px] bg-surface-sunken px-3 py-2.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-[15px] font-extrabold uppercase text-primary-fg" aria-hidden="true">{initials}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Logging session for</p>
              <p className="truncate text-[18px] font-extrabold capitalize text-ink">{childName}</p>
            </div>
          </div>
        )}
        <StepProgress current={step} reached={reached} complete={stepComplete} onGo={goToStep} />
      </div>

      <div ref={stepBodyRef} className="flex-1 overflow-y-auto px-4 pb-8 pt-5">
        {serverError && <InlineErrorBanner message={serverError} className="mb-5" />}

        <StepHeader title={LOG_STEPS[step].title} index={step} total={LOG_STEPS.length} optional={step === 2} />

        {/* ---------- 1. DETAILS ---------- */}
        {step === 0 && (
          <TimeFields
            date={form.date}
            startTime={form.startTime}
            endTime={form.endTime}
            zeroTime={zeroTime}
            totalMinutes={totalMinutes}
            onDate={(v) => setField("date", v)}
            onStart={(v) => setField("startTime", v)}
            onEnd={(v) => setField("endTime", v)}
            onZeroTime={handleZeroTimeToggle}
            errorFor={errorFor}
            before={
              <div className="flex flex-col gap-2.5">
                <p className="text-[18px] font-extrabold text-ink">How did the session happen?</p>
                <div role="radiogroup" aria-label="How did the session happen?" className="grid grid-cols-2 gap-2.5">
                  {([["person", "In person", Users], ["tele", "Video (telepractice)", Video]] as const).map(([key, label, Icon]) => {
                    const on = (key === "tele") === isTelepractice;
                    return (
                      <button key={key} type="button" role="radio" aria-checked={on} onClick={() => setTelepractice(key === "tele")}
                        className={cn("press-scale flex min-h-[92px] flex-col items-start justify-between rounded-[16px] border-2 p-3.5 text-left text-[16.5px] font-bold leading-snug", on ? "border-primary bg-primary-tint text-ink" : "border-border-strong bg-surface text-ink")}>
                        <span className={cn("flex size-10 items-center justify-center rounded-[12px]", on ? "bg-primary text-primary-fg" : "bg-surface-sunken text-ink-body")}><Icon className="size-5" aria-hidden="true" /></span>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {isTelepractice && (
                  <p className="rounded-[14px] bg-primary-tint px-3.5 py-3 text-[14.5px] font-semibold text-ink-body">
                    We&apos;ll email the parent a link to review and sign remotely instead of collecting their signature here.
                  </p>
                )}
              </div>
            }
          />
        )}

        {/* ---------- 2. CODES ---------- */}
        {step === 1 && (
          <CodeFields
            type={form.type}
            status={form.status}
            location={form.location}
            groupSizeCategory={form.groupSizeCategory}
            customFields={form.customFields}
            serviceTypeOptions={allowedServiceTypeOptions}
            statusOptions={statusOptions}
            locationOptions={locationOptions}
            groupSizeOptions={groupSizeOptions}
            customCategories={customCategories}
            dropdownOptions={dropdownOptions}
            onField={(k, v) => setField(k, v)}
            onCustomField={(k, v) => {
              setTouched(true);
              setForm((f) => ({ ...f, customFields: { ...f.customFields, [k]: v } }));
            }}
            errorFor={errorFor}
            prefilledNote={prefilledFromLast ? `Filled in from ${patient?.first_name ? `${patient.first_name}'s` : "the"} last session. Change anything below.` : null}
            extra={isIndependentPractitioner ? (
              <CompanyAffiliationField
                value={form.companyAffiliation}
                onChange={(v) => setField("companyAffiliation", v)}
                agencies={agencies}
                rosterAgencies={rosterAgencies}
                onAgencyCreated={fetchAgencies}
                error={errorFor("the agency") ? "An agency is required." : null}
              />
            ) : null}
          />
        )}

        {/* ---------- 3. NOTES ---------- */}
        {step === 2 && <NotesField value={form.note} onChange={(v) => setField("note", v)} />}

        {/* ---------- 4. SIGN ---------- */}
        {step === 3 && (
          <div className="flex flex-col gap-6">
            <div className="overflow-hidden rounded-[18px] border-2 border-border bg-surface">
              {[
                ["When", `${prettyDate(form.date)} · ${zeroTime ? "Cancelled, 0 min" : `${fmt12(form.startTime)} to ${fmt12(form.endTime)}`}`, 0],
                ["How", isTelepractice ? "Video (telepractice)" : "In person", 0],
                ["Service", optionLabel(allowedServiceTypeOptions, form.type), 1],
                ["Status", optionLabel(statusOptions, form.status), 1],
                ["Location", `${optionLabel(locationOptions, form.location)}${form.groupSizeCategory ? ` · ${optionLabel(groupSizeOptions, form.groupSizeCategory)}` : ""}`, 1],
                ["Notes", form.note.trim() ? (form.note.trim().length > 60 ? `${form.note.trim().slice(0, 60)}…` : form.note.trim()) : "None", 2],
              ].map(([k, v, target]) => (
                <div key={k as string} className="grid grid-cols-[84px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-border px-3.5 py-3 first:border-t-0">
                  <span className="text-[12.5px] font-bold uppercase tracking-wide text-ink-muted">{k}</span>
                  <span className="min-w-0 break-words text-base font-extrabold text-ink">{v}</span>
                  <button type="button" onClick={() => goToStep(target as number)} className="press-scale rounded-control px-2 py-1.5 text-[15px] font-extrabold text-primary">Edit</button>
                </div>
              ))}
            </div>

            {isTelepractice ? (
              <div className="flex flex-col gap-2.5">
                <p className="text-[18px] font-extrabold text-ink">Parent / caregiver signature</p>
                {patient?.parent_email ? (
                  <p className="rounded-[16px] border-2 border-primary bg-primary-tint p-4 text-base font-semibold text-ink">
                    We&apos;ll email <b>{patient.parent_email}</b> a link to review and sign this session.
                  </p>
                ) : (
                  <div className="rounded-[16px] border-2 border-danger-border bg-danger-bg p-4">
                    <p className="text-base font-bold text-danger">No parent email on file</p>
                    <p className="mt-1 text-sm text-danger">Add a parent email on this child&apos;s Edit screen before sending a telepractice session.</p>
                    <button type="button" onClick={() => navigate(`/patients/${patientId}/edit`)} className="press-scale mt-2 text-sm font-bold text-danger underline">Edit child</button>
                  </div>
                )}
              </div>
            ) : (
              <SignatureCapture
                large
                autoCommit
                label="Parent / caregiver signature"
                instructions="Parent or caregiver signature — draw with your finger or stylus"
                value={parentSig}
                onChange={(v) => { setParentSig(v); setTouched(true); }}
                error={errorFor("the parent's signature") ? "The parent needs to sign." : null}
              />
            )}
            <SignatureCapture
              large
              autoCommit
              label="Your signature"
              instructions="Practitioner signature — draw with your finger or stylus"
              value={practitionerSig}
              onChange={handlePractitionerSigChange}
              savedSignature={profile?.signature}
              isUsingSaved={isUsingSaved}
              onUseSaved={handleUseSavedSignature}
              showSaveAsDefault
              saveAsDefault={saveAsDefault}
              onSaveAsDefaultChange={setSaveAsDefault}
              error={errorFor("your signature") ? "Your signature is required." : null}
            />
          </div>
        )}
      </div>

      {/* bottom: what is missing, then Back / Next (or Save) */}
      <StepFooter
        missing={currentMissing}
        showErrors={showErrors}
        isFirst={step === 0}
        isFinal={step === 3}
        primaryLabel={step < 3 ? `Next: ${LOG_STEPS[step + 1].label}` : isTelepractice ? "Send to Parent to Sign" : "Save Session"}
        onBack={() => goToStep(step - 1)}
        onPrimary={step < 3 ? handleNext : handleSubmit}
        loading={submitting}
        disabled={submitting || savingDraft}
      />

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
            if (!open) setTelepractice(false);
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
