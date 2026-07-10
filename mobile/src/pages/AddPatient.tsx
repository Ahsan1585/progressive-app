import * as React from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import type { Patient, ApiErrorBody } from "@/types";

interface FormState {
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  county: string;
  childId: string;
}

const EMPTY_FORM: FormState = { firstName: "", middleName: "", lastName: "", dob: "", county: "", childId: "" };

// Pushed full screen (not a small modal) — the field count and on-screen
// keyboard need the space (design: Add Patient).
export default function AddPatient() {
  const navigate = useNavigate();
  const { fetchPatients } = useAppData();
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

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

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await api.post<{ message: string; data: Patient }>("/api/patients/register", form);
      await fetchPatients();
      navigate(`/patients/${res.data.data.id}`, { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody | { error: unknown } } }).response?.data as
        | ApiErrorBody
        | undefined;
      setServerError(
        (typeof body?.error === "string" && body.error) || "Failed to register patient. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Add patient" />
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

        <div className="pt-2">
          <Button type="submit" className="w-full" size="lg" loading={submitting}>
            Register patient
          </Button>
        </div>
      </form>
    </PushScreen>
  );
}
