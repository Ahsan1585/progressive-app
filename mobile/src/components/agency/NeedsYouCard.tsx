import * as React from "react";
import { CheckCircle2, ChevronDown, ChevronRight, CornerUpLeft, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgencyNoteItem, MoneyCount } from "@/types";
import { money, plural, shortDate } from "./format";

interface NeedsYouCardProps {
  returned: AgencyNoteItem[];
  onHold: AgencyNoteItem[];
  waitingOnFix: MoneyCount;
  onFix: (assessmentId: number) => void;
}

// Agency practitioner Home: notes billing sent back (the practitioner must fix
// them to get paid) and notes the office has on hold (nothing for them to do).
// Covers every month, not just the one picked below, since an old return still
// needs fixing. Collapsed by default: the header says how many and how much.
export function NeedsYouCard({ returned, onHold, waitingOnFix, onFix }: NeedsYouCardProps) {
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  const hasReturned = returned.length > 0;
  const heldValue = onHold.reduce((n, h) => n + h.value, 0);

  if (!hasReturned && onHold.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-card border-2 border-success bg-success-bg p-4 text-[15px] font-bold text-success">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
        Nothing needs you. All your notes are moving.
      </div>
    );
  }

  const title = hasReturned
    ? `Fix ${returned.length} returned ${plural(returned.length, "note")}`
    : `${onHold.length} ${plural(onHold.length, "note")} on hold by the office`;
  const subtitle = hasReturned
    ? `${money(waitingOnFix.value)} won't be paid until you fix ${returned.length > 1 ? "them" : "it"}.${onHold.length ? ` Also ${onHold.length} on hold.` : ""}`
    : `${money(heldValue)} paused. Nothing for you to do.`;
  const HeaderIcon = hasReturned ? CornerUpLeft : PauseCircle;

  return (
    <section
      aria-label="Needs you"
      className={cn("overflow-hidden rounded-card border-2 bg-surface", hasReturned ? "border-red-600" : "border-amber-600")}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "press-scale grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 text-left text-white",
          hasReturned ? "bg-red-600" : "bg-amber-600"
        )}
      >
        <HeaderIcon className="size-[22px]" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[17px] font-extrabold leading-tight">{title}</span>
          <span className="mt-0.5 block text-[13.5px] font-medium leading-snug opacity-95">{subtitle}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1.5 text-[13px] font-extrabold">
          {open ? "Hide" : "Show"}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div id={bodyId}>
          {hasReturned && (
            <>
              <p className="px-4 pb-1 pt-3 text-[13.5px] font-semibold text-ink-body">
                Billing sent these back with a reason. Fix and resubmit to get them paid.
              </p>
              <ul role="list">
                {returned.map((n) => (
                  <li key={n.id} className="grid grid-cols-[5px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-border py-3.5 pr-4 first:border-t-0">
                    <span className="self-stretch rounded-r bg-red-600" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[15.5px] font-extrabold capitalize text-ink">{n.childName} · {shortDate(n.serviceDate)}</p>
                      {n.reason && <p className="mt-0.5 text-sm text-ink">{n.reason}</p>}
                      {n.daysAgo !== null && (
                        <span className={cn("mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold", n.overdue ? "bg-danger-bg text-danger" : "bg-surface-sunken text-ink-muted")}>
                          Returned {n.daysAgo === 0 ? "today" : `${n.daysAgo} ${plural(n.daysAgo, "day")} ago`}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="tabular font-mono text-base font-extrabold text-ink">{money(n.value)}</p>
                      <button
                        type="button"
                        onClick={() => onFix(n.id)}
                        aria-label={`Fix it: ${n.childName}, ${shortDate(n.serviceDate)}`}
                        className="press-scale mt-1 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm font-extrabold text-primary-fg"
                      >
                        Fix it <ChevronRight className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {onHold.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2 bg-amber-600 px-4 py-3 text-[14.5px] font-extrabold text-white">
                <span>{onHold.length} on hold by the office</span>
                <span className="text-right font-semibold opacity-95">{money(heldValue)} paused. Nothing for you to do.</span>
              </div>
              <ul role="list">
                {onHold.map((n) => (
                  <li key={n.id} className="grid grid-cols-[5px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-border py-3.5 pr-4 first:border-t-0">
                    <span className="self-stretch rounded-r bg-amber-500" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[15.5px] font-extrabold capitalize text-ink">{n.childName} · {shortDate(n.serviceDate)}</p>
                      {n.reason && <p className="mt-0.5 text-sm text-ink">Office: {n.reason}</p>}
                      {n.withAdmin && !n.reason && <p className="mt-0.5 text-sm text-ink">With an admin: not found in EIMS yet.</p>}
                      {n.daysAgo !== null && (
                        <span className="mt-1.5 inline-block rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-bold text-ink-muted">
                          On hold {n.daysAgo} {plural(n.daysAgo, "day")}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="tabular font-mono text-base font-extrabold text-ink">{money(n.value)}</p>
                      <p className="text-xs font-semibold text-ink-muted">No action needed</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
