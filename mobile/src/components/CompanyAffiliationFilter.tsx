import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface CompanyAffiliationFilterProps {
  value: string;
  onChange: (value: string) => void;
  /** Every agency name the practitioner has used before — same source as
   *  CompanyAffiliationField (patients' own last_company_affiliation
   *  values), deduplicated by the caller. */
  knownAffiliations: string[];
}

// Same bottom-sheet visual pattern as Picker.tsx/CompanyAffiliationField.tsx,
// but for narrowing a list (Generate SEVF's filters) rather than setting a
// value on a session — so this always includes an "All agencies" reset
// option and, unlike CompanyAffiliationField, has no "Add new" affordance:
// you can only filter by an agency that already exists in your own logged
// sessions, not invent a new one here.
export function CompanyAffiliationFilter({ value, onChange, knownAffiliations }: CompanyAffiliationFilterProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div>
      <Label htmlFor="companyAffiliationFilter">Agency</Label>
      <button
        id="companyAffiliationFilter"
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="press-scale flex h-12 w-full items-center justify-between rounded-control border border-border bg-surface px-3.5 text-left text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      >
        <span className="truncate">{value || "All agencies"}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-labelledby="company-affiliation-filter-title">
          <SheetHeader>
            <SheetTitle id="company-affiliation-filter-title">Agency</SheetTitle>
          </SheetHeader>
          <ul role="listbox" aria-label="Agency" className="-mx-1 max-h-[60vh] space-y-0.5 overflow-y-auto">
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
                All agencies
                {!value && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
            </li>
            {knownAffiliations.map((name) => {
              const isSelected = name === value;
              return (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                    className={cn(
                      "press-scale flex min-h-[48px] w-full items-center justify-between rounded-control px-3 text-left text-[15px]",
                      isSelected ? "bg-primary-tint text-primary font-medium" : "text-ink hover:bg-surface-sunken"
                    )}
                  >
                    {name}
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
