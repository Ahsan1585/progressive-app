import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Check, X, AlertTriangle } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLayout } from "@/components/shell/AuthLayout";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { isPasswordStrong, getPasswordRules } from "@/utils/password";
import { cn } from "@/lib/utils";
import type { ApiErrorBody } from "@/types";

// Blocks all other navigation until complete (design: no tab bar, no back
// navigation — this screen must not be escapable).
export default function ForcedPasswordChange() {
  const navigate = useNavigate();
  const { completePasswordChange } = useAuth();

  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const rules = getPasswordRules(newPassword);
  const strong = isPasswordStrong(newPassword);
  const mismatch = touched && confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);

    if (!strong) {
      setError("Password does not meet the requirements below.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/auth/change-password", { newPassword });
      completePasswordChange();
      navigate("/home", { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Failed to update password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <h2 className="text-[20px] font-semibold leading-[26px] text-ink">Set a new password</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            You must set a new password to continue — this step can't be skipped.
          </p>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-card border border-danger-border bg-danger-bg p-3.5 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        <Field id="newPassword" label="New password">
          <PasswordInput
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            onBlur={() => setTouched(true)}
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
          <PasswordInput
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => setTouched(true)}
            required
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Secure account &amp; continue
        </Button>
      </form>
    </AuthLayout>
  );
}
