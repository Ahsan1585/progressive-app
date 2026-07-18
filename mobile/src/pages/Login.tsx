import * as React from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, Share } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLayout } from "@/components/shell/AuthLayout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import type { LoginResponse, ApiErrorBody } from "@/types";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, logoutBanner, clearLogoutBanner } = useAuth();
  const { canPromptInstall, promptInstall, showIOSInstructions } = useInstallPrompt();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const resetSuccess = (location.state as { resetSuccess?: boolean } | null)?.resetSuccess;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<LoginResponse>("/api/auth/login", { email, password });
      if (res.data.success) {
        clearLogoutBanner();
        login(res.data);
        if (res.data.practitioner.role !== "practitioner") {
          navigate("/unsupported-role", { replace: true });
        } else if (res.data.requirePasswordChange) {
          navigate("/change-password", { replace: true });
        } else {
          navigate("/home", { replace: true });
        }
      }
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Login failed. Please check your credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <h2 className="text-center text-[20px] font-semibold leading-[26px] text-ink">Sign in</h2>

        {logoutBanner && (
          <div role="status" className="flex items-start gap-2 rounded-card border border-info-border bg-info-bg p-3.5 text-sm text-info">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              {logoutBanner === "idle"
                ? "You were logged out after 15 minutes of inactivity to protect patient information."
                : "You were signed out. Please sign back in."}
            </p>
          </div>
        )}

        {resetSuccess && (
          <div role="status" className="flex items-start gap-2 rounded-card border border-success-border bg-success-bg p-3.5 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Your password has been reset. You can now sign in.</p>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-card border border-danger-border bg-danger-bg p-3.5 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        <Field id="email" label="Email address">
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <div>
          <Field id="password" label="Password">
            <PasswordInput
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Link to="/forgot-password" className="mt-2 inline-block text-sm font-medium text-primary">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Sign in
        </Button>
      </form>

      {canPromptInstall && (
        <div className="pop-in mt-6 flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary">
            <Download className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium text-ink">Install this app</p>
            <p className="text-xs text-ink-muted">Add it to your home screen for faster access in the field.</p>
          </div>
          <Button type="button" size="sm" onClick={promptInstall}>
            Install
          </Button>
        </div>
      )}

      {showIOSInstructions && (
        <div className="pop-in mt-6 flex items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary">
            <Share className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium text-ink">Install this app</p>
            <p className="text-xs text-ink-muted">
              Tap the Share icon <Share className="inline size-3 align-text-bottom" aria-hidden="true" />, then "Add to Home Screen" for faster access in the field.
            </p>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
