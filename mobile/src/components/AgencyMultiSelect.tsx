import * as React from "react";
import { X, Plus } from "lucide-react";
import api from "@/api/axiosInstance";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Agency, ApiErrorBody } from "@/types";

interface AgencyMultiSelectProps {
  /** The full set of selected agencies — chips are rendered from this, and
   *  it's updated in place (the caller owns persistence, e.g. writing it to
   *  PUT /api/patients/:id/agencies on save). */
  value: Agency[];
  onChange: (agencies: Agency[]) => void;
  /** The practitioner's saved agencies (AppDataContext's shared `agencies`),
   *  offered as the pick list inside the sheet. */
  agencies: Agency[];
  onAgencyCreated?: (agency: Agency) => void;
}

// Add/Edit Patient's "Agencies" field — a roster of 0..N agencies this
// child is currently billed to (see PUT /api/patients/:id/agencies). Chips
// with an inline remove (x), a "+ Add" sheet listing every saved agency not
// already selected, plus the same inline "create a new agency" affordance
// CompanyAffiliationField offers on the Log Session screen.
export function AgencyMultiSelect({ value, onChange, agencies, onAgencyCreated }: AgencyMultiSelectProps) {
  const { showToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  const selectedIds = new Set(value.map((a) => a.id));
  const available = agencies.filter((a) => !selectedIds.has(a.id));

  const removeAgency = (id: number) => {
    onChange(value.filter((a) => a.id !== id));
  };

  const addAgency = (agency: Agency) => {
    onChange([...value, agency]);
    setOpen(false);
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
      addAgency(res.data.agency);
      setAdding(false);
      setNewName("");
      setNewEmail("");
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't add this agency.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <Label>Agencies</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {value.map((agency) => (
          <span key={agency.id} className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary-tint py-1.5 pl-3.5 pr-2 text-sm font-semibold text-primary">
            {agency.name}
            <button type="button" onClick={() => removeAgency(agency.id)} aria-label={`Remove ${agency.name}`} className="press-scale flex size-5 items-center justify-center rounded-full">
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            setOpen(true);
          }}
          className="press-scale flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-3.5 py-1.5 text-sm font-semibold text-primary"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Add
        </button>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">
        Every agency currently billing for this child — offered as quick picks when logging a session.
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-labelledby="agency-multiselect-title">
          <SheetHeader>
            <SheetTitle id="agency-multiselect-title">Add an agency</SheetTitle>
          </SheetHeader>

          {adding ? (
            <div className="space-y-3 py-2">
              <Label htmlFor="new-roster-agency-name">New agency name</Label>
              <Input id="new-roster-agency-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Bright Beginnings EI" disabled={isSaving} autoFocus />
              <Label htmlFor="new-roster-agency-email">Contact email (optional)</Label>
              <Input id="new-roster-agency-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="billing@agency.org" disabled={isSaving} />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAdding(false)} disabled={isSaving}>
                  Back
                </Button>
                <Button className="flex-1" onClick={commitNew} disabled={!newName.trim()} loading={isSaving}>
                  Add agency
                </Button>
              </div>
            </div>
          ) : (
            <ul role="listbox" aria-label="Agencies" className="-mx-1 max-h-[60vh] space-y-0.5 overflow-y-auto">
              {available.length === 0 && (
                <li className="px-3 py-2 text-sm text-ink-muted">Every saved agency is already added.</li>
              )}
              {available.map((agency) => (
                <li key={agency.id}>
                  <button
                    type="button"
                    role="option"
                    onClick={() => addAgency(agency)}
                    className="press-scale flex min-h-[48px] w-full items-center rounded-control px-3 text-left text-[15px] text-ink hover:bg-surface-sunken"
                  >
                    {agency.name}
                  </button>
                </li>
              ))}
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
