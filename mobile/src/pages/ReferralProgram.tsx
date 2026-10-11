import * as React from "react";
import { Copy, Share2, Gift } from "lucide-react";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import api from "@/api/axiosInstance";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate } from "@/utils/time";
import type { ReferralSummary } from "@/types";

const WEB_URL = (import.meta.env.VITE_FRONTEND_URL as string | undefined) || "https://izayaedge.com/eis";

// Independent-practitioner-only, reached from Profile -> Referral program.
// Referral code is the practitioner's own login slug, returned by
// GET /api/referrals as `referralCode` (not read from useAuth() — the
// mobile client's auth state has no slug field; see the referral program
// design spec/plan ledger for why the API response carries it instead).
export default function ReferralProgram() {
  const { showToast } = useToast();
  const [data, setData] = React.useState<ReferralSummary | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const referralLink = data ? `${WEB_URL}/practitioners?ref=${data.referralCode}` : "";

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<ReferralSummary & { success: boolean }>("/api/referrals");
      setData(res.data);
    } catch {
      setError("Couldn't load your referral program.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      showToast("Referral link copied");
    } catch {
      showToast("Couldn't copy the link", "error");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join Izaya One", url: referralLink });
      } catch {
        // user cancelled the share sheet — no action needed
      }
    } else {
      handleCopy();
    }
  };

  return (
    <PushScreen>
      <AppBar title="Referral program" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {error ? (
          <InlineErrorBanner message={error} onRetry={fetchData} />
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[100px] w-full" />
            <Skeleton className="h-[90px] w-full" />
            <Skeleton className="h-[72px] w-full" />
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
              <p className="text-[13px] font-semibold text-ink-muted">Free months earned</p>
              <p className="tabular mt-1 text-[28px] font-bold text-ink">{data?.freeMonthsOwed ?? 0}</p>
              <p className="mt-1 text-xs text-ink-muted">
                You get a free month once someone you refer pays for their second month.
              </p>
            </div>

            <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
              <p className="text-[13px] font-semibold text-ink-muted">Your referral link</p>
              <p className="mt-1 break-all text-[13px] text-ink">{referralLink}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="press-scale flex flex-1 items-center justify-center gap-1.5 rounded-control border border-border bg-bg py-2 text-sm font-semibold text-ink"
                >
                  <Copy className="size-3.5" aria-hidden="true" /> Copy
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="press-scale flex flex-1 items-center justify-center gap-1.5 rounded-control bg-primary py-2 text-sm font-semibold text-white"
                >
                  <Share2 className="size-3.5" aria-hidden="true" /> Share
                </button>
              </div>
            </div>

            {!data?.referrals.length ? (
              <EmptyState
                icon={Gift}
                heading="No referrals yet"
                subtext="Share your link — your first referral starts earning you a free month once they pay for their second month."
              />
            ) : (
              <ul className="space-y-2">
                {data.referrals.map((r) => (
                  <li
                    key={r.referredDisplayName}
                    className="flex items-center justify-between rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]"
                  >
                    <span className="text-[15px] font-medium text-ink">{r.referredDisplayName}</span>
                    {r.status === "rewarded" ? (
                      <span className="text-xs font-semibold text-success">
                        Reward earned {r.rewardedAt ? formatSafeDate(r.rewardedAt) : ""}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-ink-muted">Invited</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PushScreen>
  );
}
