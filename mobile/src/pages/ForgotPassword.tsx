import * as React from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import api from "@/api/axiosInstance";
import { AuthLayout } from "@/components/shell/AuthLayout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function ForgotPassword() {
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/api/auth/forgot-password", { email });
    } catch {
      // Intentionally ignored — the backend always responds generically either way.
    } finally {
      setSubmitted(true);
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {submitted ? (
        <div className="space-y-6 text-center">
          <div role="status" className="flex items-start gap-2 rounded-card border border-success-border bg-success-bg p-3.5 text-left text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>If an account exists with that email, a password reset link has been sent. Check your inbox.</p>
          </div>
          <Link to="/login" className="inline-block text-sm font-semibold text-primary">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div>
            <h2 className="text-[20px] font-semibold leading-[26px] text-ink">Forgot your password?</h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              Enter the email on file and we'll send you a link to reset your password.
            </p>
          </div>

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

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Send reset link
          </Button>

          <div className="pt-2 text-center">
            <Link to="/login" className="text-sm font-medium text-ink-muted">
              Back to sign in
            </Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
