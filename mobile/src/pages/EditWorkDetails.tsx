import * as React from "react";
import { useNavigate } from "react-router-dom";
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
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import type { ApiErrorBody } from "@/types";

// Independent-practitioner-only self-service editor for fields a normal
// tenant practitioner can never touch themselves (name, discipline/service
// types, hourly rate are office-staff-only there). This role IS the
// office-equivalent of their own single-seat company — writes go straight
// to PATCH /api/staff/:id (updateStaffProfile, already reachable via the
// req.isAdmin fast-path — see authMiddleware.js), not the approval-gated
// PATCH /api/practitioner/contact-info a normal practitioner's Edit Contact
// Info screen uses. Address/phone stay on that existing Contact Info screen
// (still reachable for this role too) rather than duplicated here, so
// there's exactly one place each field is editable.
export default function EditWorkDetails() {
  const navigate = useNavigate();
  const { profile, fetchProfile, serviceTypeOptions } = useAppData();
  const { practitioner } = useAuth();
  const { showToast } = useToast();

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [discipline, setDiscipline] = React.useState("");
  const [payRate, setPayRate] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setDiscipline(profile.service_types?.[0] || "");
      setPayRate(profile.pay_rate != null ? String(profile.pay_rate) : "");
      setAddress(profile.address || "");
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!practitioner?.id) return;
    setSubmitting(true);
    try {
      await api.patch(`/api/staff/${practitioner.id}`, {
        firstName,
        lastName,
        service_types: discipline ? [discipline] : [],
        payRate,
        address,
      });
      await fetchProfile();
      showToast("Work details updated.");
      navigate("/profile", { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setServerError(body?.error || "Failed to update work details. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Work details" />
      <form onSubmit={handleSubmit} noValidate className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {serverError && <InlineErrorBanner message={serverError} />}

        <Field id="firstName" label="First name">
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </Field>
        <Field id="lastName" label="Last name">
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </Field>
        <Picker
          id="discipline"
          label="Discipline"
          value={discipline}
          options={serviceTypeOptions}
          onChange={setDiscipline}
        />
        <Field id="payRate" label="Hourly rate ($)">
          <Input type="number" inputMode="decimal" min="0" step="0.01" value={payRate} onChange={(e) => setPayRate(e.target.value)} />
        </Field>
        <Field id="address" label="Address" optional>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City, State" />
        </Field>

        <div className="pt-2">
          <Button type="submit" className="w-full" size="lg" loading={submitting}>
            Save changes
          </Button>
        </div>
      </form>
    </PushScreen>
  );
}
