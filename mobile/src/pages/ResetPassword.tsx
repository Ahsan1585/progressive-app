import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, X, AlertTriangle } from "lucide-react";
import api from "@/api/axiosInstance";
import { AuthLayout } from "@/components/shell/AuthLayout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { isPasswordStrong, getPasswordRules } from "@/utils/password";
import { cn } from "@/lib/utils";
import type { ApiErrorBody } from "@/types";

// Supports both a deep-linked token (pre-filled) and manual token paste,
// since deep linking cannot be assumed reliable on every device (design flow 4).
export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const tokenFromLink = searchParams.get("token");
  const navigate = useNavigate();

  const [token, setToken] = React.useState(tokenFromLink ?? "");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expired, setExpired] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const rules = getPasswordRules(newPassword);
  const strong = isPasswordStrong(newPassword);
  const mismatch = touched && confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    setExpired(false);

    if (!token.trim()) {
      setError("Enter the reset token from your email.");
      return;
    }
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
      await api.post("/api/auth/reset-password", { token: token.trim(), newPassword });
      navigate("/login", { replace: true, state: { resetSuccess: true } });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      const message = body?.error || "Failed to reset password. Please request a new link.";
      setError(message);
      if (message.toLowerCase().includes("invalid") || message.toLowerCase().includes("expired")) {
        setExpired(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (expired) {
    return (
      <AuthLayout>
        <div className="space-y-6 text-center">
          <div className="flex items-start gap-2 rounded-card border border-danger-border bg-danger-bg p-3.5 text-left text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>This reset link is invalid or expired.</p>
          </div>
          <Link to="/forgot-password" className="inline-block text-sm font-semibold text-primary">
            Request a new reset link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <h2 className="text-[20px] font-semibold leading-[26px] text-ink">Set a new password</h2>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-card border border-danger-border bg-danger-bg p-3.5 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        <Field
          id="token"
          label="Reset token"
          hint={tokenFromLink ? undefined : "Paste the token from your reset email."}
        >
          <Input value={token} onChange={(e) => setToken(e.target.value)} required />
        </Field>

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
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
}
