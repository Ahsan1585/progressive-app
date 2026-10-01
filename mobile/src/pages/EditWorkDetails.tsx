import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { cn } from "@/lib/utils";
import type { ApiErrorBody } from "@/types";

// Independent-practitioner-only self-service editor for fields a normal
// tenant practitioner can never touch themselves (name, discipline/service
// types, hourly rate are office-staff-only there). This role IS the
// office-equivalent of their own single-seat company — writes go straight
// to PATCH /api/auth/staff/:id (updateStaffProfile, already reachable via the
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
  // service_types has always been a real array column (see
  // authController.js's updateStaffProfile) — this screen previously only
  // ever wrote a single value into it via a Picker. Now a proper multi-select,
  // same vocabulary as the Service Type dropdown category (Profile ->
  // Dropdown options), so an independent practitioner who provides more than
  // one discipline (e.g. both OT and DI) can select every one they need for
  // logging sessions, not just the first.
  const [serviceTypes, setServiceTypes] = React.useState<string[]>([]);
  const [payRate, setPayRate] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [operatesAsBusiness, setOperatesAsBusiness] = React.useState(false);
  const [legalEntityName, setLegalEntityName] = React.useState("");
  // Write-only, like the web admin's Staff Directory edit form — updateStaffProfile
  // never returns the stored value, so this always starts blank; submitting
  // blank leaves whatever's already on file untouched (see index.js/authController.js).
  const [ssn, setSsn] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setServiceTypes(profile.service_types || []);
      setPayRate(profile.pay_rate != null ? String(profile.pay_rate) : "");
      setAddress(profile.address || "");
      setOperatesAsBusiness(!!profile.legal_entity_name);
      setLegalEntityName(profile.legal_entity_name || "");
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!practitioner?.id) return;
    setSubmitting(true);
    try {
      if (serviceTypes.length === 0) {
        setServerError("Select at least one service type.");
        setSubmitting(false);
        return;
      }
      await api.patch(`/api/auth/staff/${practitioner.id}`, {
        firstName,
        lastName,
        service_types: serviceTypes,
        payRate,
        address,
        ssn: ssn.trim() || undefined,
      });
      // Separate endpoint — legal_entity_name lives on company_settings,
      // not the practitioners row updateStaffProfile writes (see
      // PATCH /api/practitioner/business-entity in index.js).
      await api.patch("/api/practitioner/business-entity", {
        legalEntityName: operatesAsBusiness ? legalEntityName : "",
      });
      setSsn("");
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
        <div>
          <Label>Service types / disciplines</Label>
          <div className="mt-1.5 space-y-2 rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]">
            {serviceTypeOptions.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No service types configured yet — add some under Profile → Dropdown options.
              </p>
            ) : (
              serviceTypeOptions.map((option) => {
                const isChecked = serviceTypes.includes(option.code);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="checkbox"
                    aria-checked={isChecked}
                    onClick={() =>
                      setServiceTypes((prev) =>
                        prev.includes(option.code) ? prev.filter((c) => c !== option.code) : [...prev, option.code]
                      )
                    }
                    className="press-scale flex w-full items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors",
                        isChecked ? "border-primary bg-primary" : "border-border bg-transparent"
                      )}
                      aria-hidden="true"
                    >
                      {isChecked && <Check className="size-3.5 text-primary-fg" />}
                    </span>
                    <span className="flex-1 text-[15px] text-ink">{option.label}</span>
                  </button>
                );
              })
            )}
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            Select every discipline you provide services under — you can pick more than one.
          </p>
        </div>
        <Field id="payRate" label="Hourly rate ($)">
          <Input type="number" inputMode="decimal" min="0" step="0.01" value={payRate} onChange={(e) => setPayRate(e.target.value)} />
        </Field>
        <Field id="address" label="Address" optional>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City, State" />
        </Field>

        <div className="rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
          <button
            type="button"
            role="checkbox"
            aria-checked={operatesAsBusiness}
            onClick={() => setOperatesAsBusiness((v) => !v)}
            className="press-scale flex w-full items-center gap-3 text-left"
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors",
                operatesAsBusiness ? "border-primary bg-primary" : "border-border bg-transparent"
              )}
              aria-hidden="true"
            >
              {operatesAsBusiness && <Check className="size-3.5 text-primary-fg" />}
            </span>
            <span className="flex-1 text-[15px] font-medium text-ink">
              I operate through a registered business (LLC, PLLC, etc.)
            </span>
          </button>
          {operatesAsBusiness && (
            <Field id="legalEntityName" label="Business name" className="mt-3">
              <Input
                value={legalEntityName}
                onChange={(e) => setLegalEntityName(e.target.value)}
                placeholder="e.g. Jane Doe Therapy LLC"
                required
              />
            </Field>
          )}
          <p className="mt-3 text-xs text-ink-muted">
            When checked, this name is used for your Izaya billing instead of your own name.
          </p>
        </div>

        <Field id="ssn" label="SSN / EIN" optional hint="Write-only — always shown blank. Leave blank to keep what's on file.">
          <Input
            value={ssn}
            onChange={(e) => setSsn(e.target.value)}
            placeholder={operatesAsBusiness ? "Business EIN" : "SSN"}
            maxLength={11}
          />
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
