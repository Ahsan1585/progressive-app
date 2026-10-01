import * as React from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CompanyAffiliationFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Every agency name the practitioner has actually used before,
   *  most-recently-used first — from GET /api/billing/independent/affiliations
   *  (see LogIntervention.tsx), the real per-session history. */
  knownAffiliations: string[];
  error?: string | null;
}

// Independent-practitioner-only field (see LogIntervention.tsx) for which
// early intervention agency a session is billed to. Visually mirrors
// Picker.tsx's bottom-sheet pattern (touch-sized rows, same Sheet
// primitives) but — unlike Picker, which only serves the fixed NJEIS
// vocabularies — adds an inline "Add new" affordance, since this
// vocabulary is entirely practitioner-defined and grows over time (see
// docs on the independent-practitioner feature, "practitioner-grown
// dropdown" requirement).
export function CompanyAffiliationField({ value, onChange, knownAffiliations, error }: CompanyAffiliationFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [newValue, setNewValue] = React.useState("");

  const openSheet = () => {
    setAdding(false);
    setNewValue("");
    setOpen(true);
  };

  const commitNew = () => {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setOpen(false);
  };

  return (
    <div>
      <Label htmlFor="companyAffiliation">Agency</Label>
      <button
        id="companyAffiliation"
        type="button"
        onClick={openSheet}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={!!error}
        className={cn(
          "press-scale flex h-12 w-full items-center justify-between rounded-control border bg-surface px-3.5 text-left text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
          error ? "border-danger" : "border-border",
          value ? "text-ink" : "text-ink-faint"
        )}
      >
        <span className="truncate">{value || "Select an agency"}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-labelledby="company-affiliation-picker-title">
          <SheetHeader>
            <SheetTitle id="company-affiliation-picker-title">Agency</SheetTitle>
          </SheetHeader>

          {adding ? (
            <div className="space-y-3 py-2">
              <Label htmlFor="new-affiliation">New agency name</Label>
              <Input
                id="new-affiliation"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g. Bright Beginnings EI"
                autoFocus
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAdding(false)}>
                  Back
                </Button>
                <Button className="flex-1" onClick={commitNew} disabled={!newValue.trim()}>
                  Use this agency
                </Button>
              </div>
            </div>
          ) : (
            <ul role="listbox" aria-label="Agency" className="-mx-1 max-h-[60vh] space-y-0.5 overflow-y-auto">
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
              <li>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="press-scale flex min-h-[48px] w-full items-center gap-2 rounded-control px-3 text-left text-[15px] font-medium text-primary"
                >
                  <Plus className="size-4 shrink-0" aria-hidden="true" />
                  Add new agency
                </button>
              </li>
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
