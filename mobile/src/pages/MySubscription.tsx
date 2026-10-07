import * as React from "react";
import { ExternalLink } from "lucide-react";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import api from "@/api/axiosInstance";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { formatSafeDate } from "@/utils/time";
import type { FlatSubscriptionSummary, SubscriptionPaymentMethod } from "@/types";

const money = (n: number) => `$${n.toFixed(2)}`;

// Web fallback for adding/updating a payment method — Stripe Elements card
// capture is deliberately NOT built natively in this mobile app (no Stripe
// SDK integrated here at all yet; see docs on the independent-practitioner
// feature's Phase 4 scoping decision). Reuses the same security posture as
// the existing web admin checkout instead of a rushed, unverified native
// card form.
const WEB_BILLING_URL = (import.meta.env.VITE_FRONTEND_URL as string | undefined) || "https://izayaedge.com/eis";

// Independent-practitioner-only — moved here from the Billing tab (which is
// now scoped to the practitioner's own billable-session activity, not their
// own account subscription) so account-level settings live together under
// Profile, matching Contact info/Work details/Change password.
export default function MySubscription() {
  const [summary, setSummary] = React.useState<FlatSubscriptionSummary | null>(null);
  const [paymentMethod, setPaymentMethod] = React.useState<SubscriptionPaymentMethod | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [summaryRes, paymentRes] = await Promise.all([
        api.get<{ success: boolean; summary: FlatSubscriptionSummary }>("/api/subscription/summary"),
        api.get<{ success: boolean; paymentMethod: SubscriptionPaymentMethod | null }>("/api/subscription/payment-method"),
      ]);
      setSummary(summaryRes.data.summary);
      setPaymentMethod(paymentRes.data.paymentMethod);
    } catch {
      setError("Couldn't load your subscription.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <PushScreen>
      <AppBar title="My Subscription" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {error ? (
          <InlineErrorBanner message={error} onRetry={fetchData} />
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[120px] w-full" />
            <Skeleton className="h-[72px] w-full" />
          </div>
        ) : (
          <>
            {summary && (
              <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
                <p className="text-[13px] font-semibold text-ink-muted">This month</p>
                <p className="tabular mt-1 text-[28px] font-bold text-ink">{money(summary.totalAmount)}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Next billing date {formatSafeDate(summary.nextBillingDate)}
                </p>
              </div>
            )}

            <div className="rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
              <p className="text-[13px] font-semibold text-ink-muted">Payment method</p>
              {paymentMethod ? (
                <p className="mt-1 text-[15px] font-medium text-ink">
                  {paymentMethod.brand ? `${paymentMethod.brand} ····` : "Card ····"} {paymentMethod.last4}
                </p>
              ) : (
                <p className="mt-1 text-[15px] text-ink-muted">No payment method on file</p>
              )}
              <a
                href={`${WEB_BILLING_URL}/billing/independent`}
                target="_blank"
                rel="noreferrer"
                className="press-scale mt-3 flex items-center gap-1.5 text-sm font-semibold text-primary"
              >
                Manage payment method <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </>
        )}
      </div>
    </PushScreen>
  );
}
