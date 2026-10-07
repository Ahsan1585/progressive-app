import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PatientOption {
  id: number;
  name: string;
}

interface PatientNameFilterProps {
  value: number | null;
  onChange: (patientId: number | null) => void;
  options: PatientOption[];
}

// Same bottom-sheet pattern as CompanyAffiliationFilter — narrows Generate
// SEVF's preview list to one child, with an "All children" reset option.
// Keyed on patient id (not name) since two different children could share a
// first+last name; the sheet still displays the name for selection.
export function PatientNameFilter({ value, onChange, options }: PatientNameFilterProps) {
  const [open, setOpen] = React.useState(false);
  const selectedName = options.find((o) => o.id === value)?.name;

  return (
    <div>
      <Label htmlFor="patientNameFilter">Child</Label>
      <button
        id="patientNameFilter"
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="press-scale flex h-12 w-full items-center justify-between rounded-control border border-border bg-surface px-3.5 text-left text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      >
        <span className="truncate">{selectedName || "All children"}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-labelledby="patient-name-filter-title">
          <SheetHeader>
            <SheetTitle id="patient-name-filter-title">Child</SheetTitle>
          </SheetHeader>
          <ul role="listbox" aria-label="Child" className="-mx-1 max-h-[60vh] space-y-0.5 overflow-y-auto">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={cn(
                  "press-scale flex min-h-[48px] w-full items-center justify-between rounded-control px-3 text-left text-[15px]",
                  value === null ? "bg-primary-tint text-primary font-medium" : "text-ink hover:bg-surface-sunken"
                )}
              >
                All children
                {value === null && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
            </li>
            {options.map((option) => {
              const isSelected = option.id === value;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "press-scale flex min-h-[48px] w-full items-center justify-between rounded-control px-3 text-left text-[15px]",
                      isSelected ? "bg-primary-tint text-primary font-medium" : "text-ink hover:bg-surface-sunken"
                    )}
                  >
                    {option.name}
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
