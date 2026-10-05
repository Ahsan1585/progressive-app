import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FilterPickerOption {
  code: string;
  label: string;
}

interface FilterPickerProps {
  id: string;
  label: string;
  value: string; // "" means no filter applied
  options: FilterPickerOption[];
  onChange: (code: string) => void;
  allLabel?: string; // e.g. "All statuses"
}

// Same bottom-sheet pattern as Picker.tsx/CompanyAffiliationFilter.tsx, but
// generic over any code/label list and always includes a reset ("All ...")
// row — unlike Picker, which requires a real value to always be selected.
// Built for narrowing a list (e.g. Patient Detail's session-history
// filters), not for setting a value on a session.
export function FilterPicker({ id, label, value, options, onChange, allLabel = `All ${label.toLowerCase()}` }: FilterPickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.code === value);

  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="press-scale flex h-11 w-full items-center justify-between rounded-control border border-border bg-surface px-3 text-left text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      >
        <span className="truncate">{selected ? selected.label : allLabel}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-labelledby={`${id}-filter-title`}>
          <SheetHeader>
            <SheetTitle id={`${id}-filter-title`}>{label}</SheetTitle>
          </SheetHeader>
          <ul role="listbox" aria-label={label} className="-mx-1 max-h-[60vh] space-y-0.5 overflow-y-auto">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className={cn(
                  "press-scale flex min-h-[48px] w-full items-center justify-between rounded-control px-3 text-left text-[15px]",
                  !value ? "bg-primary-tint text-primary font-medium" : "text-ink hover:bg-surface-sunken"
                )}
              >
                {allLabel}
                {!value && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
            </li>
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
