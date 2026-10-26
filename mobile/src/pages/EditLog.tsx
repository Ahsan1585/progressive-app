import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { DateChangeNotice, RESIGN_BUTTON_LABEL, ResignSentDialog, sameDay } from "@/components/DateChangeResign";
import { StepProgress } from "@/components/logSession/StepProgress";
import { CodeFields, NotesField, StepFooter, StepHeader, TimeFields } from "@/components/logSession/StepSections";
import { stepMissing, type StepContext } from "@/utils/logSessionSteps";
import { calculateTotalMinutes } from "@/utils/time";
import type { Assessment, ApiErrorBody } from "@/types";

// Only for logs still sitting at billing_status "pending" (or, for an
// independent practitioner, its own equivalent "self_certified" — no
// SEVF/invoice generated yet) — a "rejected" log already has its own
// dedicated edit+resubmit flow (ResubmitLog.tsx), and anything further
// along the billing pipeline isn't the practitioner's record to change
// anymore (mirrors the backend's editLog/deleteLog gate in
// patientController.js; a "completed" independent-practitioner log's only
// remaining action is Reject, from PatientDetail.tsx directly).
// Editing has no signature step: the same big Details / Codes / Notes steps as Log Session.
const EDIT_STEPS = [
  { id: "details", label: "Details", title: "When it happened" },
  { id: "codes", label: "Codes", title: "Service codes" },
  { id: "notes", label: "Notes", title: "Session notes" },
] as const;

export default function EditLog() {
  const { id: patientId, logId } = useParams<{ id: string; logId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { profile, serviceTypeOptions, statusOptions, locationOptions, groupSizeOptions, dropdownOptions, dropdownCategories } = useAppData();
  const customCategories = React.useMemo(
    () => dropdownCategories.filter((c) => c.is_custom && c.is_active),
    [dropdownCategories]
  );

  const [loading, setLoading] = React.useState(true);
  const [notEditable, setNotEditable] = React.useState(false);
  // The saved date and status: a new date on a pending (parent-signed) note
  // goes to the parent to re-sign instead of saving straight away.
  const [original, setOriginal] = React.useState<{ date: string; billingStatus: string } | null>(null);
  const [resignSentTo, setResignSentTo] = React.useState<string | null>(null);

  const allowedServiceTypeOptions = React.useMemo(() => {
    const allowed = profile?.service_types;
    if (!allowed || allowed.length === 0) return serviceTypeOptions;
    return serviceTypeOptions.filter((opt) => allowed.includes(opt.code));
  }, [profile, serviceTypeOptions]);

  const [form, setForm] = React.useState({
    date: "",
    startTime: "",
    endTime: "",
    status: "",
    type: "",
    location: "",
    groupSizeCategory: "individual",
    customFields: {} as Record<string, string>,
    sessionNotes: "",
  });
  const [zeroTime, setZeroTime] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState(0);
  const [reached, setReached] = React.useState(0);
  const [triedNext, setTriedNext] = React.useState<boolean[]>([false, false, false]);
  const stepBodyRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!patientId || !logId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<Assessment[]>(`/api/patients/${patientId}/assessments`);
        const found = res.data.find((a) => String(a.id) === logId) || null;
        if (!found || !["pending", "self_certified"].includes(found.billing_status)) {
          setNotEditable(true);
        } else {
          setForm({
            date: found.service_date,
            startTime: found.start_time || "",
            endTime: found.end_time || "",
            status: found.status || "",
            type: found.type || "",
            location: found.location || "",
            groupSizeCategory: found.group_size_category || "individual",
            customFields: found.form_data?.custom_fields || {},
            sessionNotes: found.session_notes || "",
          });
          setZeroTime(!found.start_time && !found.end_time);
          setOriginal({ date: found.service_date, billingStatus: found.billing_status });
        }
      } catch {
        setNotEditable(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [patientId, logId]);

  const totalMinutes = calculateTotalMinutes(form.startTime, form.endTime);
  const needsResign = !!original && original.billingStatus === "pending" && !!form.date && !sameDay(form.date, original.date);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleZeroTimeToggle = (checked: boolean) => {
    setZeroTime(checked);
    setForm((f) => ({ ...f, startTime: "", endTime: "" }));
  };

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
    isIndependentPractitioner: false,
    companyAffiliation: "",
    isTelepractice: false,
    parentEmailOnFile: true,
    parentSig: "unchanged",
    practitionerSig: "unchanged",
  };
  const missingFor = (i: number) => (i < 2 ? stepMissing(i, stepCtx) : []);
  const stepComplete = EDIT_STEPS.map((_, i) => missingFor(i).length === 0);
  const currentMissing = missingFor(step);
  const showErrors = triedNext[step];
  const errorFor = (key: string) => showErrors && currentMissing.includes(key);
  const missing = [...missingFor(0), ...missingFor(1)];

  const goToStep = (target: number) => {
    setStep(target);
    setReached((r) => Math.max(r, target));
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

  const handleSubmit = async () => {
    if (!logId) return;
    if (missing.length > 0) {
      const target = missingFor(0).length ? 0 : 1;
      setTriedNext((t) => t.map((v, i) => (i === target ? true : v)));
      goToStep(target);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.put<{ success: boolean; resignRequested?: boolean; parentEmail?: string }>(`/api/patients/logs/${logId}`, {
        service_date: form.date,
        start_time: form.startTime || null,
        end_time: form.endTime || null,
        status: form.status,
        type: form.type,
        location: form.location,
        group_size_category: form.groupSizeCategory,
        total_time: totalMinutes,
        custom_fields: form.customFields,
        session_notes: form.sessionNotes,
      });
      if (res.data?.resignRequested) {
        setResignSentTo(res.data.parentEmail || "");
        return;
      }
      showToast("Log updated.");
      navigate(`/patients/${patientId}`, { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "There was an error saving your changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Edit Log" onBack={() => navigate(-1)} />

      {loading ? (
        <p className="px-4 py-6 text-base text-ink-muted">Loading…</p>
      ) : notEditable ? (
        <div className="px-4 py-6">
          <InlineErrorBanner message="This log can no longer be edited — it may have already moved into billing review, or it's a returned log (edit it from your Inbox instead)." />
        </div>
      ) : (
        <>
          <div className="border-b border-border bg-surface px-4 pb-3.5 pt-3">
            <StepProgress steps={EDIT_STEPS} current={step} reached={reached} complete={stepComplete} onGo={goToStep} />
          </div>

          <div ref={stepBodyRef} className="flex-1 overflow-y-auto px-4 pb-8 pt-5">
            {error && <InlineErrorBanner message={error} className="mb-5" />}
            <StepHeader title={EDIT_STEPS[step].title} index={step} total={EDIT_STEPS.length} optional={step === 2} />
            {needsResign && <div className="mb-5"><DateChangeNotice /></div>}

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
              />
            )}

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
                onCustomField={(k, v) => setForm((f) => ({ ...f, customFields: { ...f.customFields, [k]: v } }))}
                errorFor={errorFor}
              />
            )}

            {step === 2 && <NotesField value={form.sessionNotes} onChange={(v) => setField("sessionNotes", v)} />}
          </div>

          <StepFooter
            missing={currentMissing}
            showErrors={showErrors}
            isFirst={step === 0}
            isFinal={step === EDIT_STEPS.length - 1}
            primaryLabel={step < EDIT_STEPS.length - 1 ? `Next: ${EDIT_STEPS[step + 1].label}` : needsResign ? RESIGN_BUTTON_LABEL : "Save changes"}
            readyText={needsResign ? "Ready to send to the parent" : "Ready to save your changes"}
            onBack={() => goToStep(step - 1)}
            onPrimary={step < EDIT_STEPS.length - 1 ? handleNext : handleSubmit}
            loading={submitting}
            disabled={submitting}
          />
        </>
      )}
      <ResignSentDialog parentEmail={resignSentTo} onDone={() => navigate(`/patients/${patientId}`, { replace: true })} />
    </PushScreen>
  );
}
