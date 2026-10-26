import { CalendarClock, Send } from "lucide-react";
import { timeAgo } from "@/utils/time";
import type { TelepracticeSignatureRequest } from "@/types";

const shortDay = (iso?: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

// One note waiting for a parent's signature on the child's page: a
// telepractice session (Resend), or a date change (Resend + Undo).
export function AwaitingSignatureRow({ request, onResend, onUndo, resending }: {
  request: TelepracticeSignatureRequest;
  onResend: () => void;
  onUndo: () => void;
  resending: boolean;
}) {
  const isDateChange = request.kind === "date_change";
  const Icon = isDateChange ? CalendarClock : Send;
  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-[var(--elev-rest)]">
      <div className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          {isDateChange ? (
            <>
              <p className="text-xs font-bold uppercase tracking-wide text-info">Date change</p>
              <p className="tabular text-sm font-semibold text-ink">
                <span className="text-ink-muted line-through">{shortDay(request.previous_service_date)}</span> → {shortDay(request.service_date)}
              </p>
            </>
          ) : (
            <p className="tabular text-sm font-semibold text-ink">{shortDay(request.service_date)}</p>
          )}
          <p className="text-xs text-ink-muted [overflow-wrap:anywhere]">Sent {timeAgo(request.resent_at || request.sent_at)} to {request.parent_email}</p>
        </div>
        <button
          type="button"
          onClick={onResend}
          disabled={resending}
          className="press-scale shrink-0 rounded-control border border-border-strong px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
        >
          {resending ? "Sending..." : "Resend"}
        </button>
      </div>
      {isDateChange && (
        <button type="button" onClick={onUndo} className="mt-2 text-xs font-semibold text-danger">
          Undo date change
        </button>
      )}
    </div>
  );
}
