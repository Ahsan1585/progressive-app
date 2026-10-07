import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AutoDismissNoticeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: string;
  /** Defaults to 3000ms. */
  durationMs?: number;
}

// A light-blue, centered, self-dismissing notice — distinct from both
// ConfirmDialog (blocks until an explicit choice) and EmailSentDialog
// (blocks until an explicit OK, since it confirms a document left the app
// to a real outside recipient). This is for an action that already had its
// own confirm step (e.g. reverting a SEVF, confirmed via ConfirmDialog
// first) and just needs a clear, hard-to-miss "done" moment — no second tap
// required, no backdrop blocking the screen behind it, gone on its own.
export function AutoDismissNotice({ open, onOpenChange, message, durationMs = 3000 }: AutoDismissNoticeProps) {
  React.useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => onOpenChange(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [open, durationMs, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50"
      // Tapping the backdrop dismisses early — never traps the practitioner
      // waiting out the timer if they want to move on immediately.
      onClick={() => onOpenChange(false)}
    >
      {/* .modal-panel's own keyframes (index.css) bake in
          translate(-50%, -50%), matching DialogContent's exact
          `fixed left-1/2 top-1/2` positioning — reused here instead of a
          flex-centered wrapper, which would double up that translate and
          shove the panel off-center/off-screen. */}
      <div
        data-state="open"
        className={cn(
          "modal-panel pointer-events-auto fixed left-1/2 top-1/2 flex w-[calc(100%-3rem)] max-w-sm items-center gap-3 rounded-card border border-primary/30 bg-primary-tint px-5 py-4 text-center shadow-[var(--elev-overlay)]"
        )}
      >
        <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-[15px] font-medium text-ink">{message}</p>
      </div>
    </div>
  );
}
