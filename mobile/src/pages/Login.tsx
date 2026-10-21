import * as React from "react";
import { useNavigate, useLocation, useSearchParams, Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, Share } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLayout } from "@/components/shell/AuthLayout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { MfaSetup } from "@/components/mfa/MfaSetup";
import { mfaVerify, errMsg, digitsOnly } from "@/components/mfa/mfaApi";
import { getDeviceToken, setDeviceToken, clearDeviceToken, setCurrentUser } from "@/components/mfa/trustedDevice";
import type { LoginResponse, ApiErrorBody } from "@/types";

type LoginStepResponse = Partial<LoginResponse> & {
  clearDeviceToken?: boolean;
  mfaRequired?: boolean;
  mfaEnrollmentRequired?: boolean;
  mfaToken?: string;
};

// No company registered with Izaya yet? Independent practitioners sign up
// on the web (the marketing site + signup wizard live in frontend/, not
// this app) — same cross-app link pattern as Billing.tsx's "Manage payment
// method" link. On the shared app, this links to the /practitioners pitch
// page first (the visitor may not know what this is yet); on the
// separately-deployed Izaya One build, every visitor already IS an
// independent practitioner by definition, so it skips straight to the
// signup wizard instead of showing them their own app's own marketing
// pitch for itself.
const WEB_URL = (import.meta.env.VITE_FRONTEND_URL as string | undefined) || "https://izayaedge.com/eis";
const SIGNUP_PATH = import.meta.env.VITE_APP_BRAND === "one" ? "/signup/independent" : "/practitioners";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { login, logoutBanner, clearLogoutBanner } = useAuth();
  const { canPromptInstall, promptInstall, showIOSInstructions, isInstalled, isInstalling } = useInstallPrompt();

  // Arrived here specifically to install (e.g. the "Get it on Android/iPhone"
  // links on the web login page) — lead with the install card instead of
  // burying it below the sign-in form.
  const arrivedToInstall = searchParams.get("install") === "1";

  const [companySlug, setCompanySlug] = React.useState(() => {
    try { return localStorage.getItem("companySlug") || ""; } catch { return ""; }
  });
  // Pre-filled when arriving here right after ActivateAccount/ResetPassword
  // succeeded — the point of landing here instead of a bare route is that
  // company + email are already filled in, only the password remains.
  const locationState = location.state as { resetSuccess?: boolean; email?: string } | null;
  const [email, setEmail] = React.useState(locationState?.email || "");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const resetSuccess = locationState?.resetSuccess;

  // "password" | "code" (MFA challenge) | "enroll" (forced MFA enrollment)
  const [step, setStep] = React.useState<"password" | "code" | "enroll">("password");
  const [mfaToken, setMfaToken] = React.useState("");
  const [mfaCode, setMfaCode] = React.useState("");
  const [useRecovery, setUseRecovery] = React.useState(false);
  const [rememberDevice, setRememberDevice] = React.useState(false);

  const finishLogin = (data: LoginResponse, slug: string) => {
    try { localStorage.setItem("companySlug", slug); } catch { /* ignore */ }
    setCurrentUser(slug, email);
    clearLogoutBanner();
    login(data);
    if (!["practitioner", "independent_practitioner"].includes(data.practitioner.role)) {
      navigate("/unsupported-role", { replace: true });
    } else if (data.requirePasswordChange) {
      navigate("/change-password", { replace: true });
    } else {
      navigate("/home", { replace: true });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const slug = companySlug.trim().toLowerCase();
      const deviceToken = getDeviceToken(slug, email);
      const res = await api.post<LoginStepResponse>(
        "/api/auth/login",
        deviceToken ? { slug, email, password, deviceToken } : { slug, email, password },
      );
      if (res.data.clearDeviceToken) clearDeviceToken(slug, email);
      if (res.data.mfaRequired && res.data.mfaToken) {
        setMfaToken(res.data.mfaToken);
        setMfaCode("");
        setUseRecovery(false);
        setRememberDevice(false);
        setStep("code");
      } else if (res.data.mfaEnrollmentRequired && res.data.mfaToken) {
        setMfaToken(res.data.mfaToken);
        setStep("enroll");
      } else if (res.data.success) {
        finishLogin(res.data as LoginResponse, slug);
      }
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Login failed. Please check your credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await mfaVerify({
        mfaToken,
        ...(useRecovery ? { recoveryCode: mfaCode.trim() } : { code: mfaCode }),
        ...(rememberDevice ? { rememberDevice: true } : {}),
      });
      if (data.success) {
        const slug = companySlug.trim().toLowerCase();
        if (data.deviceToken) setDeviceToken(slug, email, data.deviceToken, data.deviceTokenExpiresAt, data.deviceId);
        finishLogin(data, slug);
      }
    } catch (err) {
      setError(errMsg(err, "Verification failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const backToPassword = () => {
    setStep("password");
    setMfaToken("");
    setMfaCode("");
    setError(null);
  };

  const installCard = isInstalling ? (
    <div className="pop-in flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary">
        <Download className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink">Installing Izaya…</p>
        <div className="progress-bar-track mt-2" role="progressbar" aria-label="Installing">
          <div className="progress-bar-indeterminate" />
        </div>
      </div>
    </div>
  ) : canPromptInstall ? (
    <div className="pop-in flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
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
  ) : showIOSInstructions ? (
    <div className="pop-in flex items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
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
  ) : null;

  if (arrivedToInstall) {
    return (
      <AuthLayout>
        <h2 className="text-center text-[20px] font-semibold leading-[26px] text-ink">Install the app</h2>

        <div className="mt-5">
          {installCard ?? (
            <div className="flex items-start gap-2 rounded-card border border-info-border bg-info-bg p-3.5 text-sm text-info">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {isInstalled
                  ? "You already have the app installed — open it from your home screen."
                  : "Open this link on your Android or iPhone to install the app."}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm font-medium text-ink-muted">
            Already installed? Sign in instead
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (step === "code") {
    return (
      <AuthLayout>
        <form onSubmit={handleVerify} className="space-y-5" noValidate>
          <h2 className="text-center text-[20px] font-semibold leading-[26px] text-ink">Two-step verification</h2>
          <p className="text-center text-sm text-ink-muted">
            {useRecovery ? "Enter one of your saved recovery codes." : "Enter the 6-digit code from your authenticator app."}
          </p>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-card border border-danger-border bg-danger-bg p-3.5 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          <Field id="mfa-code" label={useRecovery ? "Recovery code" : "Verification code"}>
            <Input
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              maxLength={useRecovery ? 32 : 6}
              placeholder={useRecovery ? "xxxxx-xxxxx" : "123456"}
              value={mfaCode}
              onChange={(e) => setMfaCode(useRecovery ? e.target.value : digitsOnly(e.target.value))}
              required
            />
          </Field>

          <label className="flex items-start gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
              className="mt-0.5 size-5 shrink-0"
            />
            <span>
              Remember this device for 30 days
              <span className="mt-0.5 block text-xs text-ink-muted">
                Only on a device you trust. You can remove devices any time in Security settings.
              </span>
            </span>
          </label>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={submitting}
            disabled={useRecovery ? !mfaCode.trim() : mfaCode.length !== 6}
          >
            Verify
          </Button>

          <div className="flex items-center justify-between">
            <button type="button" className="text-sm font-medium text-ink-muted" onClick={backToPassword}>
              Back
            </button>
            <button
              type="button"
              className="text-sm font-medium text-primary"
              onClick={() => {
                setUseRecovery((v) => !v);
                setMfaCode("");
                setError(null);
              }}
            >
              {useRecovery ? "Use authenticator code instead" : "Use a recovery code instead"}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  if (step === "enroll") {
    return (
      <AuthLayout>
        <div className="space-y-5">
          <h2 className="text-center text-[20px] font-semibold leading-[26px] text-ink">Set up two-step verification</h2>
          <p className="text-center text-sm text-ink-muted">
            Your company requires two-step verification. Set it up now to finish signing in.
          </p>
          <MfaSetup
            mfaToken={mfaToken}
            trustedKey={{ slug: companySlug.trim().toLowerCase(), email }}
            onEnrolled={(payload) => finishLogin(payload as LoginResponse, companySlug.trim().toLowerCase())}
          />
          <div className="text-center">
            <button type="button" className="text-sm font-medium text-ink-muted" onClick={backToPassword}>
              Back to sign in
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <h2 className="text-center text-[20px] font-semibold leading-[26px] text-ink">Sign in</h2>

        {logoutBanner && (
          <div role="status" className="flex items-start gap-2 rounded-card border border-info-border bg-info-bg p-3.5 text-sm text-info">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              {logoutBanner === "idle"
                ? "You were logged out after 15 minutes of inactivity to protect child information."
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

        <Field id="company-code" label="Company Code">
          <Input
            autoCapitalize="none"
            autoCorrect="off"
            value={companySlug}
            onChange={(e) => setCompanySlug(e.target.value)}
            required
          />
        </Field>

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

        <p className="text-center text-sm text-ink-muted">
          No company code?{" "}
          <a href={`${WEB_URL}${SIGNUP_PATH}`} className="font-medium text-primary">
            Sign up as an independent practitioner
          </a>
        </p>
      </form>

      {installCard && <div className="mt-6">{installCard}</div>}
    </AuthLayout>
  );
}
