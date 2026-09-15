import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, X, AlertTriangle, CircleCheck } from "lucide-react";
import api from "@/api/axiosInstance";
import { AuthLayout } from "@/components/shell/AuthLayout";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { isPasswordStrong, getPasswordRules } from "@/utils/password";
import { cn } from "@/lib/utils";
import type { ApiErrorBody } from "@/types";

// Mirrors ResetPassword.tsx closely (same card, same flow, same password
// rules checklist) so a practitioner clicking their invite email recognizes
// the same app. Reached via a role-aware activation link — practitioners'
// invite/resend-invite emails now point here (mobile/app.izayaedge.com)
// instead of the office web app's own /activate screen (see
// buildActivateUrl in backend/src/utils/practitionerRegistration.js).
export default function ActivateAccount() {
  const { companySlug, token } = useParams();
  const navigate = useNavigate();

  const [companyName, setCompanyName] = React.useState<string | null>(null);
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // Set once activation succeeds — holding here (instead of navigating
  // straight to /login) gives the practitioner a real confirmation screen
  // before moving on, rather than being dropped somewhere with no
  // acknowledgment that anything happened.
  const [activatedEmail, setActivatedEmail] = React.useState<string | null>(null);

  const rules = getPasswordRules(newPassword);
  const strong = isPasswordStrong(newPassword);
  const mismatch = touched && confirmPassword.length > 0 && newPassword !== confirmPassword;

  React.useEffect(() => {
    if (!companySlug) return;
    api.get(`/api/auth/${companySlug}/company-name`)
      .then(({ data }) => setCompanyName(data.displayName))
      .catch(() => setCompanyName(null));
  }, [companySlug]);

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
      const { data } = await api.post(`/api/auth/${companySlug}/activate/${token}`, { newPassword });
      try { localStorage.setItem("companySlug", companySlug || ""); } catch { /* ignore */ }
      setActivatedEmail(data.email || "");
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Failed to activate your account. Please request a new invite.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoToLogin = () => {
    // Company code is already in localStorage (set just above) and Login
    // reads it from there on its own, same as any returning user.
    navigate("/login", { replace: true, state: { resetSuccess: true, email: activatedEmail } });
  };

  if (!companySlug || !token) {
    return (
      <AuthLayout>
        <div className="space-y-6 text-center">
          <div className="flex items-start gap-2 rounded-card border border-danger-border bg-danger-bg p-3.5 text-left text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>This activation link is missing or invalid. Ask your administrator to resend your invite.</p>
          </div>
          <Link to="/login" className="inline-block text-sm font-semibold text-primary">
            Back to Sign In
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (activatedEmail !== null) {
    return (
      <AuthLayout>
        <div className="space-y-6 text-center">
          <div className="flex justify-center">
            <div className="flex size-14 items-center justify-center rounded-full border border-success-border bg-success-bg">
              <CircleCheck className="size-7 text-success" aria-hidden="true" />
            </div>
          </div>
          <div>
            <h2 className="text-[20px] font-semibold leading-[26px] text-ink">Your password has been set</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Your account{companyName ? ` for ${companyName}` : ""} is ready to go — you can sign in now.
            </p>
          </div>
          <Button type="button" size="lg" className="w-full" onClick={handleGoToLogin}>
            Continue to Sign In
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <h2 className="text-[20px] font-semibold leading-[26px] text-ink">
          Activate your account{companyName ? ` — ${companyName}` : ""}
        </h2>
        <p className="text-sm text-ink-muted">Choose a password to finish setting up your account.</p>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-card border border-danger-border bg-danger-bg p-3.5 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        <Field id="newPassword" label="Password">
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

        <Field id="confirmPassword" label="Confirm Password" error={mismatch ? "Passwords do not match." : null}>
          <PasswordInput
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => setTouched(true)}
            required
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Activate Account
        </Button>
      </form>
    </AuthLayout>
  );
}
