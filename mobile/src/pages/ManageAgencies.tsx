import * as React from "react";
import { Plus, Pencil, Trash2, Mail, Phone, Building2 } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import type { Agency, ApiErrorBody } from "@/types";

// Independent-practitioner-only — a real, practitioner-owned directory of
// the early intervention agencies they bill to, replacing free-text-only
// agency entry (see CompanyAffiliationField.tsx). Card-list CRUD pattern
// borrowed from DropdownOptionsManager.tsx. An agency's saved email is what
// powers one-tap "Email to Agency" on a generated SEVF/invoice (see
// GenerateSevf.tsx/SevfHistory.tsx + resolveAgencyEmail in
// agencyController.js) — this screen is where that email actually gets set.
function AgencyForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: Agency;
  onCancel: () => void;
  onSaved: (agency: Agency) => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = React.useState(initial?.name || "");
  const [email, setEmail] = React.useState(initial?.email || "");
  const [phone, setPhone] = React.useState(initial?.phone || "");
  const [isSaving, setIsSaving] = React.useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      showToast("An agency name is required.", "error");
      return;
    }
    setIsSaving(true);
    try {
      const body = { name: name.trim(), email: email.trim() || null, phone: phone.trim() || null };
      const res = initial
        ? await api.put<{ success: boolean; agency: Agency }>(`/api/agencies/${initial.id}`, body)
        : await api.post<{ success: boolean; agency: Agency }>("/api/agencies", body);
      onSaved(res.data.agency);
    } catch (err) {
      const errBody = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(errBody?.error || "Couldn't save this agency.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-card border border-primary/40 bg-surface p-3.5">
      <Field id="agencyName" label="Agency name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bright Beginnings EI" disabled={isSaving} autoFocus />
      </Field>
      <Field id="agencyEmail" label="Contact email" optional hint="Used to send generated SEVFs/invoices directly to this agency.">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@agency.org" disabled={isSaving} />
      </Field>
      <Field id="agencyPhone" label="Phone" optional>
        <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={isSaving} />
      </Field>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={handleSave} loading={isSaving}>
          Save
        </Button>
      </div>
    </div>
  );
}

function AgencyCard({ agency, onChanged }: { agency: Agency; onChanged: () => void }) {
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await api.delete(`/api/agencies/${agency.id}`);
      setConfirmDelete(false);
      onChanged();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't remove this agency.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  if (isEditing) {
    return (
      <AgencyForm
        initial={agency}
        onCancel={() => setIsEditing(false)}
        onSaved={() => {
          setIsEditing(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-3.5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
        <Building2 className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink">{agency.name}</p>
        {agency.email ? (
          <p className="flex items-center gap-1 truncate text-xs text-ink-muted">
            <Mail className="size-3 shrink-0" aria-hidden="true" /> {agency.email}
          </p>
        ) : (
          <p className="text-xs text-warning">No email on file — can't auto-fill when sending</p>
        )}
        {agency.phone && (
          <p className="flex items-center gap-1 truncate text-xs text-ink-faint">
            <Phone className="size-3 shrink-0" aria-hidden="true" /> {agency.phone}
          </p>
        )}
      </div>
      <button type="button" onClick={() => setIsEditing(true)} aria-label={`Edit ${agency.name}`} className="press-scale flex size-9 shrink-0 items-center justify-center rounded-control text-ink-muted">
        <Pencil className="size-4" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => setConfirmDelete(true)} aria-label={`Remove ${agency.name}`} className="press-scale flex size-9 shrink-0 items-center justify-center rounded-control text-danger">
        <Trash2 className="size-4" aria-hidden="true" />
      </button>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove this agency?"
        description={`"${agency.name}" won't appear as a choice for new sessions or on any child's agency list. Past logs/SEVFs that used this name are unaffected.`}
        confirmLabel="Remove"
        destructive
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}

export default function ManageAgencies() {
  const { agencies, agenciesLoading, fetchAgencies } = useAppData();
  const [isAdding, setIsAdding] = React.useState(false);

  React.useEffect(() => {
    fetchAgencies();
  }, [fetchAgencies]);

  return (
    <PushScreen>
      <AppBar title="Manage Agencies" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <p className="mb-4 text-sm text-ink-muted">
          The agencies you bill to. Save a contact email here so a generated SEVF and invoice can be sent to the right place with one tap instead of typing it in every time.
        </p>

        <div className="space-y-2">
          {agenciesLoading ? (
            <>
              <Skeleton className="h-[76px] w-full" />
              <Skeleton className="h-[76px] w-full" />
            </>
          ) : agencies.length === 0 && !isAdding ? (
            <EmptyState
              icon={Building2}
              heading="No agencies yet"
              subtext="Add the agencies you bill to so they're a quick pick when logging sessions and generating SEVFs."
            />
          ) : (
            agencies.map((agency) => <AgencyCard key={agency.id} agency={agency} onChanged={fetchAgencies} />)
          )}

          {isAdding ? (
            <AgencyForm
              onCancel={() => setIsAdding(false)}
              onSaved={() => {
                setIsAdding(false);
                fetchAgencies();
              }}
            />
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setIsAdding(true)}>
              <Plus className="size-4" aria-hidden="true" /> Add agency
            </Button>
          )}
        </div>
      </div>
    </PushScreen>
  );
}
