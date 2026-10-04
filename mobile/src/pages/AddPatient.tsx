import * as React from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { AgencyMultiSelect } from "@/components/AgencyMultiSelect";
import { useToast } from "@/components/ui/toast";
import type { Agency, Patient, ApiErrorBody } from "@/types";

interface FormState {
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  county: string;
  childId: string;
  parentName: string;
  parentEmail: string;
}

const EMPTY_FORM: FormState = {
  firstName: "",
  middleName: "",
  lastName: "",
  dob: "",
  county: "",
  childId: "",
  parentName: "",
  parentEmail: "",
};

// Pushed full screen (not a small modal) — the field count and on-screen
// keyboard need the space (design: Add Patient).
export default function AddPatient() {
  const navigate = useNavigate();
  const { fetchPatients, agencies, fetchAgencies } = useAppData();
  const { isIndependentPractitioner } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [selectedAgencies, setSelectedAgencies] = React.useState<Agency[]>([]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const validateChildId = (value: string) => (/^\d{9}$/.test(value) ? null : "Child ID must be exactly 9 digits.");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const nextErrors: Partial<Record<keyof FormState, string>> = {};
    if (form.firstName.trim().length < 2) nextErrors.firstName = "First name must be at least 2 characters.";
    if (form.lastName.trim().length < 2) nextErrors.lastName = "Last name must be at least 2 characters.";
    if (!form.dob) nextErrors.dob = "Date of birth is required.";
    if (form.county.trim().length < 2) nextErrors.county = "County is required.";
    const childIdError = validateChildId(form.childId);
    if (childIdError) nextErrors.childId = childIdError;
    if (form.parentEmail.trim() && !/^\S+@\S+\.\S+$/.test(form.parentEmail.trim())) {
      nextErrors.parentEmail = "Enter a valid email address.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await api.post<{ message: string; data: Patient; linked?: boolean }>("/api/patients/register", form);
      // Roster is a separate write (PUT /api/patients/:id/agencies) — needs
      // the patient's real id, which only exists after registration
      // succeeds. Non-fatal if it fails: the patient itself is already
      // saved either way, and the roster can be set later from Edit Patient.
      if (isIndependentPractitioner && selectedAgencies.length > 0) {
        try {
          await api.put(`/api/patients/${res.data.data.id}/agencies`, {
            agencyIds: selectedAgencies.map((a) => a.id),
          });
        } catch {
          showToast("Child saved, but couldn't save their agencies — you can set them from Edit Child.", "error");
        }
      }
      await fetchPatients();
      // A Child ID already registered by another practitioner attaches to
      // that same shared record rather than failing — worth flagging so it
      // doesn't read like an ordinary "added" confirmation.
      if (res.data.linked) {
        showToast(res.data.message || "This child was already registered — linked to your child list.");
      }
      navigate(`/patients/${res.data.data.id}`, { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody | { error: unknown } } }).response?.data as
        | ApiErrorBody
        | undefined;
      setServerError(
        (typeof body?.error === "string" && body.error) || "Failed to register child. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Add child" />
      <form onSubmit={handleSubmit} noValidate className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {serverError && <InlineErrorBanner message={serverError} />}

        <Field id="firstName" label="First name" error={errors.firstName}>
          <Input value={form.firstName} onChange={(e) => setField("firstName", e.target.value)} required />
        </Field>
        <Field id="middleName" label="Middle name" optional>
          <Input value={form.middleName} onChange={(e) => setField("middleName", e.target.value)} />
        </Field>
        <Field id="lastName" label="Last name" error={errors.lastName}>
          <Input value={form.lastName} onChange={(e) => setField("lastName", e.target.value)} required />
        </Field>
        <Field id="dob" label="Date of birth" error={errors.dob}>
          <Input type="date" value={form.dob} onChange={(e) => setField("dob", e.target.value)} required />
        </Field>
        <Field id="county" label="County" error={errors.county}>
          <Input value={form.county} onChange={(e) => setField("county", e.target.value)} required />
        </Field>
        <Field
          id="childId"
          label="Child ID"
          error={errors.childId}
          hint="Enter the 9-digit child ID provided."
        >
          <Input
            inputMode="numeric"
            maxLength={9}
            value={form.childId}
            onChange={(e) => setField("childId", e.target.value.replace(/\D/g, "").slice(0, 9))}
            onBlur={() => setErrors((prev) => ({ ...prev, childId: validateChildId(form.childId) ?? undefined }))}
            required
          />
        </Field>
        <Field id="parentName" label="Parent name" optional>
          <Input value={form.parentName} onChange={(e) => setField("parentName", e.target.value)} />
        </Field>
        <Field
          id="parentEmail"
          label="Parent email"
          error={errors.parentEmail}
          optional
          hint="Used to send scheduling notifications with a calendar invite."
        >
          <Input type="email" value={form.parentEmail} onChange={(e) => setField("parentEmail", e.target.value)} />
        </Field>

        {isIndependentPractitioner && (
          <AgencyMultiSelect value={selectedAgencies} onChange={setSelectedAgencies} agencies={agencies} onAgencyCreated={fetchAgencies} />
        )}

        <div className="pt-2">
          <Button type="submit" className="w-full" size="lg" loading={submitting}>
            Register child
          </Button>
        </div>
      </form>
    </PushScreen>
  );
}
