import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Option {
  code: string;
  label: string;
}

interface BigOptionsProps {
  label: string;
  value: string;
  options: Option[];
  onChange: (code: string) => void;
  required?: boolean;
  error?: string | null;
  /** "list" = full-width rows (long labels); "grid" = two columns (short labels). */
  layout?: "list" | "grid";
}

// Large, tap-friendly single choice for the step-by-step Log Session flow:
// every option visible at once (no dropdown), 60px+ tall, bold 17px text.
export function BigOptions({ label, value, options, onChange, required, error, layout = "list" }: BigOptionsProps) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-2.5">
      <p id={id} className="flex items-baseline justify-between gap-2 text-[18px] font-extrabold text-ink">
        {label}
        <span className={cn("text-sm font-semibold", required ? "text-danger" : "text-ink-muted")}>{required ? "Required" : "Optional"}</span>
      </p>
      <div role="radiogroup" aria-labelledby={id} className={cn(layout === "grid" ? "grid grid-cols-2 gap-2.5" : "flex flex-col gap-2.5")}>
        {options.map((o) => {
          const checked = o.code === value;
          return (
            <button
              key={o.code}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(o.code)}
              className={cn(
                "press-scale flex min-h-[60px] w-full items-center gap-3 rounded-[16px] border-2 px-4 py-3 text-left text-[17px] font-bold leading-snug",
                checked ? "border-primary bg-primary-tint text-ink" : "border-border-strong bg-surface text-ink"
              )}
            >
              <span className="min-w-0 flex-1">{o.label}</span>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border-2",
                  checked ? "border-primary bg-primary text-primary-fg" : "border-border-strong"
                )}
                aria-hidden="true"
              >
                {checked && <Check className="size-4" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}
