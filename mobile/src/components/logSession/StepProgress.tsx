import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOG_STEPS } from "@/utils/logSessionSteps";

interface StepProgressProps {
  /** defaults to Log Session's four steps; Edit Log passes its own three */
  steps?: readonly { id: string; label: string }[];
  current: number;
  /** furthest step the practitioner has opened; later steps stay locked */
  reached: number;
  complete: boolean[];
  onGo: (step: number) => void;
}

// Four-part progress bar for Log Session: Details, Codes, Notes, Sign.
// Finished steps turn green with a check; any reached step can be tapped.
export function StepProgress({ steps = LOG_STEPS, current, reached, complete, onGo }: StepProgressProps) {
  return (
    <div role="tablist" aria-label="Steps" className={cn("grid gap-1.5", steps.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
      {steps.map((s, i) => {
        const isNow = i === current;
        const isDone = !isNow && i <= reached && complete[i];
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={isNow}
            disabled={i > reached}
            onClick={() => onGo(i)}
            className={cn("text-left disabled:cursor-default", isNow || isDone ? "text-ink" : "text-ink-muted")}
          >
            <span className={cn("block h-1.5 rounded-full", isNow ? "bg-primary" : isDone ? "bg-success" : "bg-border")} />
            <span className="mt-1.5 flex items-center gap-1.5 text-[13.5px] font-bold">
              <span
                className={cn(
                  "flex size-[18px] items-center justify-center rounded-full font-mono text-[10.5px] font-extrabold",
                  isNow ? "bg-primary text-primary-fg" : isDone ? "bg-success text-white" : "bg-border text-ink-muted"
                )}
                aria-hidden="true"
              >
                {isDone ? <Check className="size-3" strokeWidth={3.5} /> : i + 1}
              </span>
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
