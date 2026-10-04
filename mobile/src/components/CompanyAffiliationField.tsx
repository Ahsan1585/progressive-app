import * as React from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import api from "@/api/axiosInstance";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Agency, ApiErrorBody } from "@/types";

interface CompanyAffiliationFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Every agency the practitioner has saved (Manage Agencies) — from
   *  AppDataContext's shared `agencies`. */
  agencies: Agency[];
  /** The current patient's own roster — shown as fast-tap chips above the
   *  field so picking "the usual agency" for this child is one tap instead
   *  of opening the full sheet. Still just a shortlist: any saved agency
   *  can be picked via "Choose a different agency." */
  rosterAgencies?: Agency[];
  /** Called when a brand-new agency is created inline (via "+ New agency")
   *  so the caller can refresh its own agencies list (e.g. AppDataContext's
   *  fetchAgencies) without this field needing to know about that context. */
  onAgencyCreated?: (agency: Agency) => void;
  error?: string | null;
}

// Independent-practitioner-only field (see LogIntervention.tsx) for which
// early intervention agency a session is billed to. A session still picks
// exactly ONE agency (required by the SEVF/invoice/NJEIS form math — a
// session can't be split across agencies); "multiple agencies" here means
// the child's own roster is offered as quick-pick chips instead of a
// blank search every time.
export function CompanyAffiliationField({ value, onChange, agencies, rosterAgencies, onAgencyCreated, error }: CompanyAffiliationFieldProps) {
  const { showToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  const openSheet = () => {
    setAdding(false);
    setNewName("");
    setNewEmail("");
    setOpen(true);
  };

  const commitNew = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      const res = await api.post<{ success: boolean; agency: Agency }>("/api/agencies", {
        name: trimmed,
        email: newEmail.trim() || null,
      });
      onAgencyCreated?.(res.data.agency);
      onChange(res.data.agency.name);
      setOpen(false);
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't add this agency.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const roster = rosterAgencies || [];
  // Any roster agency already covered by its own chip is skipped from the
  // "other" list inside the sheet's main list to avoid showing it twice —
  // it's still reachable there if sorted differently, but the chip is the
  // fast path.
  const rosterIds = new Set(roster.map((a) => a.id));
  const otherAgencies = agencies.filter((a) => !rosterIds.has(a.id));

  return (
    <div>
      <Label htmlFor="companyAffiliation">Agency</Label>

      {roster.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {roster.map((agency) => {
            const isSelected = agency.name === value;
            return (
              <button
                key={agency.id}
                type="button"
                onClick={() => onChange(agency.name)}
                className={cn(
                  "press-scale rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                  isSelected ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-ink"
                )}
              >
                {agency.name}
              </button>
            );
          })}
        </div>
      )}

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
        <span className="truncate">{value || (roster.length > 0 ? "Choose a different agency" : "Select an agency")}</span>
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
              <Label htmlFor="new-affiliation-name">New agency name</Label>
              <Input
                id="new-affiliation-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Bright Beginnings EI"
                disabled={isSaving}
                autoFocus
              />
              <Label htmlFor="new-affiliation-email">Contact email (optional)</Label>
              <Input
                id="new-affiliation-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="billing@agency.org"
                disabled={isSaving}
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAdding(false)} disabled={isSaving}>
                  Back
                </Button>
                <Button className="flex-1" onClick={commitNew} disabled={!newName.trim()} loading={isSaving}>
                  Use this agency
                </Button>
              </div>
            </div>
          ) : (
            <ul role="listbox" aria-label="Agency" className="-mx-1 max-h-[60vh] space-y-0.5 overflow-y-auto">
              {roster.length > 0 && (
                <li className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">This child's agencies</li>
              )}
              {roster.map((agency) => {
                const isSelected = agency.name === value;
                return (
                  <li key={`roster-${agency.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(agency.name);
                        setOpen(false);
                      }}
                      className={cn(
                        "press-scale flex min-h-[48px] w-full items-center justify-between rounded-control px-3 text-left text-[15px]",
                        isSelected ? "bg-primary-tint text-primary font-medium" : "text-ink hover:bg-surface-sunken"
                      )}
                    >
                      {agency.name}
                      {isSelected && <Check className="size-4 shrink-0" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
              {roster.length > 0 && otherAgencies.length > 0 && (
                <li className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">All agencies</li>
              )}
              {otherAgencies.map((agency) => {
                const isSelected = agency.name === value;
                return (
                  <li key={agency.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(agency.name);
                        setOpen(false);
                      }}
                      className={cn(
                        "press-scale flex min-h-[48px] w-full items-center justify-between rounded-control px-3 text-left text-[15px]",
                        isSelected ? "bg-primary-tint text-primary font-medium" : "text-ink hover:bg-surface-sunken"
                      )}
                    >
                      {agency.name}
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
