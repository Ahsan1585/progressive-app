import * as React from "react";
import { FileText, ChevronRight, Clock, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

// Tab root for an independent practitioner (replaces Messages in the tab
// bar — see TabBar.tsx). Read-only subscription summary + invoice history;
// payment-method management deep-links to the web app.
export default function Billing() {
  const navigate = useNavigate();
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
    <div className="flex min-h-full flex-col overflow-y-auto px-4 py-5">
      <h1 className="mb-4 text-[22px] font-bold text-ink">Billing</h1>

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

          <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
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

      <button
        type="button"
        onClick={() => navigate("/generate-sevf")}
        className="press-scale flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
      >
        <FileText className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="flex-1 text-[15px] font-medium text-ink">Generate SEVF</span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => navigate("/sevf-history")}
        className="press-scale mt-4 flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
      >
        <Clock className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="flex-1 text-[15px] font-medium text-ink">SEVF History</span>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
      </button>
    </div>
  );
}
