import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PickerOption {
  code: string;
  label: string;
}

interface PickerProps {
  id: string;
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (code: string) => void;
  placeholder?: string;
  error?: string | null;
}

// Touch-sized picker (bottom sheet of rows) for the fixed NJEIS vocabularies —
// never a dense desktop <select> (anti-slop guardrail, art-direction §5).
export function Picker({ id, label, value, options, onChange, placeholder = "Select...", error }: PickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.code === value);

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={!!error}
        className={cn(
          "press-scale flex h-12 w-full items-center justify-between rounded-control border bg-surface px-3.5 text-left text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
          error ? "border-danger" : "border-border",
          selected ? "text-ink" : "text-ink-faint"
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-labelledby={`${id}-picker-title`}>
          <SheetHeader>
            <SheetTitle id={`${id}-picker-title`}>{label}</SheetTitle>
          </SheetHeader>
          <ul role="listbox" aria-label={label} className="-mx-1 max-h-[60vh] space-y-0.5 overflow-y-auto">
            {options.map((opt) => {
              const isSelected = opt.code === value;
              return (
                <li key={opt.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(opt.code);
                      setOpen(false);
                    }}
                    className={cn(
                      "press-scale flex min-h-[48px] w-full items-center justify-between rounded-control px-3 text-left text-[15px]",
                      isSelected ? "bg-primary-tint text-primary font-medium" : "text-ink hover:bg-surface-sunken"
                    )}
                  >
                    {opt.label}
                    {isSelected && <Check className="size-4 shrink-0" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}
