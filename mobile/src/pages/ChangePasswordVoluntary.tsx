import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Check, X } from "lucide-react";
import api from "@/api/axiosInstance";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { isPasswordStrong, getPasswordRules } from "@/utils/password";
import { cn } from "@/lib/utils";
import type { ApiErrorBody } from "@/types";

// Reuses the same password-change form as the forced flow, but cancelable
// (design: Profile > Change Password).
export default function ChangePasswordVoluntary() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const rules = getPasswordRules(newPassword);
  const strong = isPasswordStrong(newPassword);
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!strong) {
      setError("Password does not meet the requirements below.");
      return;
    }
    if (mismatch) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/auth/change-password", { newPassword });
      showToast("Password updated.");
      navigate("/profile", { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Failed to update password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Change password" />
      <form onSubmit={handleSubmit} noValidate className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {error && <InlineErrorBanner message={error} />}

        <Field id="newPassword" label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </Field>

        <ul className="space-y-1.5 rounded-card border border-border bg-surface-sunken p-3.5" aria-live="polite">
          {rules.map((rule) => (
            <li key={rule.id} className={cn("flex items-center gap-2 text-sm", rule.met ? "text-success" : "text-ink-muted")}>
              {rule.met ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : <X className="size-3.5 shrink-0" aria-hidden="true" />}
              {rule.label}
            </li>
          ))}
        </ul>

        <Field id="confirmPassword" label="Confirm new password" error={mismatch ? "Passwords do not match." : null}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </Field>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => navigate("/profile")}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={submitting}>
            Update password
          </Button>
        </div>
      </form>
    </PushScreen>
  );
}
