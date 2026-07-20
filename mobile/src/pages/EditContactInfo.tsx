import * as React from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import type { ApiErrorBody } from "@/types";

// Self-service — a practitioner updating their own address/phone, distinct
// from the admin Staff Directory's edit-someone-else flow on the web app.
export default function EditContactInfo() {
  const navigate = useNavigate();
  const { profile, fetchProfile } = useAppData();
  const { showToast } = useToast();

  const [address, setAddress] = React.useState("");
  const [phoneNumber, setPhoneNumber] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (profile) {
      setAddress(profile.address || "");
      setPhoneNumber(profile.phone_number || "");
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setSubmitting(true);
    try {
      await api.patch("/api/practitioner/contact-info", { address, phone_number: phoneNumber });
      await fetchProfile();
      showToast("Submitted — an admin will review your change shortly.");
      navigate("/profile", { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setServerError(body?.error || "Failed to update contact information. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Contact information" />
      <form onSubmit={handleSubmit} noValidate className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {serverError && <InlineErrorBanner message={serverError} />}

        <Field id="phoneNumber" label="Phone number" optional>
          <Input
            type="tel"
            inputMode="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="555-123-4567"
          />
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
