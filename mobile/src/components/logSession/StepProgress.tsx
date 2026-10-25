import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOG_STEPS } from "@/utils/logSessionSteps";

interface StepProgressProps {
  current: number;
  /** furthest step the practitioner has opened; later steps stay locked */
  reached: number;
  complete: boolean[];
  onGo: (step: number) => void;
}

// Four-part progress bar for Log Session: Details, Codes, Notes, Sign.
// Finished steps turn green with a check; any reached step can be tapped.
export function StepProgress({ current, reached, complete, onGo }: StepProgressProps) {
  return (
    <div role="tablist" aria-label="Log session steps" className="grid grid-cols-4 gap-1.5">
      {LOG_STEPS.map((s, i) => {
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
