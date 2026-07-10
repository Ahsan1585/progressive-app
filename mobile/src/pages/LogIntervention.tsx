import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/Picker";
import { SignatureCapture } from "@/components/SignatureCapture";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { calculateTotalMinutes } from "@/utils/time";
import { SERVICE_TYPE_OPTIONS, STATUS_CODE_OPTIONS, LOCATION_CODE_OPTIONS } from "@/constants/njeis";
import { cn } from "@/lib/utils";
import type { ApiErrorBody } from "@/types";

interface FormState {
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  type: string;
  location: string;
}

const todayIso = () => new Date().toISOString().split("T")[0];

const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "codes", label: "Codes" },
  { id: "signatures", label: "Signatures" },
] as const;

export default function LogIntervention() {
  const { id: patientId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { patients, profile, setSavedSignature } = useAppData();
  const { practitioner } = useAuth();
  const { showToast } = useToast();

  const patient = patients.find((p) => p.id === patientId);

  const [form, setForm] = React.useState<FormState>({
    date: todayIso(),
    startTime: "",
    endTime: "",
    status: "",
    type: "",
    location: "",
  });
  const [parentSig, setParentSig] = React.useState<string | null>(null);
  const [practitionerSig, setPractitionerSig] = React.useState<string | null>(null);
  const [isUsingSaved, setIsUsingSaved] = React.useState(false);
  const [saveAsDefault, setSaveAsDefault] = React.useState(false);

  const [touched, setTouched] = React.useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState<string>("details");

  const sectionRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

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

  const missing: string[] = [];
  if (!form.date) missing.push("date");
  if (!form.startTime) missing.push("start time");
  if (!form.endTime) missing.push("end time");
  if (!form.type) missing.push("service type");
  if (!form.status) missing.push("status");
  if (!form.location) missing.push("location");
  if (!parentSig) missing.push("parent signature");
  if (!practitionerSig) missing.push("practitioner signature");

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

      await api.post("/api/interventions", {
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
        totalTime: totalMinutes,
        total_time: totalMinutes,
        parentSignatureBase64: parentSig,
        practitionerSignatureBase64: practitionerSig,
      });

      showToast("Encounter saved.");
      navigate(`/patients/${patientId}`, { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setServerError(body?.error || "There was an error saving the encounter. Your entries have been kept.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Log intervention" onBack={handleBack} />

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
            <Field id="startTime" label="Start time" error={attemptedSubmit && !form.startTime ? "Required." : null}>
              <Input type="time" value={form.startTime} onChange={(e) => setField("startTime", e.target.value)} required />
            </Field>
            <Field id="endTime" label="End time" error={attemptedSubmit && !form.endTime ? "Required." : null}>
              <Input type="time" value={form.endTime} onChange={(e) => setField("endTime", e.target.value)} required />
            </Field>
          </div>
          <div>
            <p className="text-[13px] font-medium leading-[18px] text-ink-body">Total time</p>
            <p className="tabular mt-1.5 text-lg font-semibold text-ink" aria-live="polite">
              {totalMinutes > 0 ? `${(totalMinutes / 60).toFixed(2)} hrs (${totalMinutes} min)` : "—"}
            </p>
          </div>
        </div>

        <div ref={(el) => { sectionRefs.current.codes = el; }} className="space-y-4">
          <h2 className="text-[15px] font-semibold text-ink">Service codes</h2>
          <Picker
            id="type"
            label="Service type"
            value={form.type}
            options={SERVICE_TYPE_OPTIONS}
            onChange={(v) => setField("type", v)}
            error={attemptedSubmit && !form.type ? "Service type is required." : null}
          />
          <Picker
            id="status"
            label="Status"
            value={form.status}
            options={STATUS_CODE_OPTIONS}
            onChange={(v) => setField("status", v)}
            error={attemptedSubmit && !form.status ? "Status is required." : null}
          />
          <Picker
            id="location"
            label="Location"
            value={form.location}
            options={LOCATION_CODE_OPTIONS}
            onChange={(v) => setField("location", v)}
            error={attemptedSubmit && !form.location ? "Location is required." : null}
          />
        </div>

        <div ref={(el) => { sectionRefs.current.signatures = el; }} className="space-y-6">
          <h2 className="text-[15px] font-semibold text-ink">Signatures</h2>
          <SignatureCapture
            label="Parent/caregiver signature"
            instructions="Parent or caregiver signature — draw with your finger or stylus"
            value={parentSig}
            onChange={(v) => { setParentSig(v); setTouched(true); }}
            error={attemptedSubmit && !parentSig ? "Parent signature is required." : null}
          />
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
        <Button className="w-full" size="lg" onClick={handleSubmit} loading={submitting} disabled={submitting}>
          Save encounter
        </Button>
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
