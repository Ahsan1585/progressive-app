import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { mfaResetWithToken } from "@/components/mfa/mfaApi";
import { AuthLayout } from "@/components/shell/AuthLayout";
import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/types";

// Opened from the "turn off two-step verification" email. The reset only runs
// when the person presses the button, never on page load, because email
// security scanners open every link in a message and would otherwise burn the
// one-time token before the user ever sees it. Uses a bare axios call so the
// shared client's session handling is never involved on this public page.
export default function MfaReset() {
  const { companySlug = "", token = "" } = useParams();
  const [state, setState] = React.useState<"ready" | "working" | "done" | "invalid">("ready");
  const [companyRequiresMfa, setCompanyRequiresMfa] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleReset = async () => {
    setState("working");
    setError(null);
    try {
      const res = await mfaResetWithToken(companySlug, token);
      setCompanyRequiresMfa(res.data.companyRequiresMfa === true);
      setState("done");
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Something went wrong. Please request a new link.");
      setState("invalid");
    }
  };

  if (state === "done") {
    return (
      <AuthLayout>
        <div className="space-y-5 text-center">
          <div className="flex items-start gap-2 rounded-card border border-info-border bg-info-bg p-3.5 text-left text-sm text-info">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Two-step verification is off for your account. Sign in to continue.</p>
          </div>
          {companyRequiresMfa && (
            <p className="text-sm text-ink-muted">
              Your organization requires two-step verification, so you will be asked to set it up again when you sign in.
            </p>
          )}
          <Link to="/login" className="inline-block">
            <Button size="lg" className="w-full">Sign in</Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (state === "invalid") {
    return (
      <AuthLayout>
        <div className="space-y-6 text-center">
          <div role="alert" className="flex items-start gap-2 rounded-card border border-danger-border bg-danger-bg p-3.5 text-left text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
          <Link to="/login" className="inline-block text-sm font-semibold text-primary">
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="space-y-5">
        <h2 className="text-center text-[20px] font-semibold leading-[26px] text-ink">Turn off two-step verification</h2>
        <p className="text-center text-sm text-ink-muted">
          This removes the authenticator app from your account so you can sign in and set it up again. Only continue if you asked for this link.
        </p>
        <Button type="button" size="lg" className="w-full" loading={state === "working"} onClick={handleReset}>
          Turn off two-step verification
        </Button>
        <div className="text-center">
          <Link to="/login" className="text-sm font-medium text-ink-muted">Cancel</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
