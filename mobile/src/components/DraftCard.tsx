import { ChevronRight, PencilLine, Trash2 } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { describeDraft } from "@/utils/describeDraft";
import { localTodayIso, timeAgo } from "@/utils/time";
import { cn } from "@/lib/utils";
import type { DraftDetails } from "@/types";

interface DraftCardProps {
  summary?: DraftDetails;
  updatedAt: string;
  /** shown on Home's list, where drafts for different children sit together */
  childName?: string;
  onResume: () => void;
  onDiscard: () => void;
}

// A saved session draft, described well enough to tell it apart from another
// draft for the same child: date and time, service and location, and what is
// still needed before it can be saved.
export function DraftCard({ summary, updatedAt, childName, onResume, onDiscard }: DraftCardProps) {
  const { serviceTypeOptions, locationOptions, profile } = useAppData();
  const label = (opts: { code: string; label: string }[]) => (code: string) => opts.find((o) => o.code === code)?.label || code;
  const d = describeDraft(
    summary,
    { serviceType: label(serviceTypeOptions), location: label(locationOptions) },
    { hasSavedSignature: !!profile?.signature, today: localTodayIso() }
  );

  return (
    <div className="flex items-center gap-1 rounded-card border border-border bg-surface pr-1 shadow-[var(--elev-rest)]">
      <button
        type="button"
        onClick={onResume}
        aria-label={`Resume draft: ${childName ? `${childName}, ` : ""}${d.when}`}
        className="press-scale flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
          <PencilLine className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          {childName && <p className="truncate text-[15px] font-bold capitalize text-ink">{childName}</p>}
          <p className={cn("truncate font-bold text-ink", childName ? "text-sm" : "text-[15px]")}>{d.when}</p>
          {d.what && <p className="truncate text-sm text-ink-body">{d.what}</p>}
          <p className="mt-0.5 text-xs text-ink-muted">
            {d.ready ? (
              <span className="font-semibold text-success">Ready to save</span>
            ) : d.stillNeeds.length ? (
              <span className="font-semibold text-warning">Still needs {d.stillNeeds.join(", ")}</span>
            ) : null}
            {(d.ready || d.stillNeeds.length > 0) && " · "}
            Saved {timeAgo(updatedAt)}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Discard draft"
        onClick={onDiscard}
        className="press-scale flex size-9 shrink-0 items-center justify-center rounded-control text-ink-faint hover:text-danger"
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
