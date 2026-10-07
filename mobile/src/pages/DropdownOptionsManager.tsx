import * as React from "react";
import { Plus, X, Check, Pencil, Trash2, RotateCcw, XCircle } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ApiErrorBody, DropdownOption } from "@/types";

// Mobile counterpart to the admin dashboard's DropdownOptionsManager.jsx —
// independent practitioners are their own ceo-equivalent admin (req.isAdmin
// fast-path, see authMiddleware.js) but have no web admin dashboard at all,
// so this is the only place they can add/rename/deactivate the options in
// each dropdown category (Service Type, Service Status, Location, Group
// Size, plus Company Affiliation and any other custom category) — same
// backend endpoints (GET/POST/PUT/DELETE /api/dropdown-options[/categories]),
// same immediate-save-per-row behavior, just a phone-shaped layout: one
// category open at a time instead of a tab strip, cards instead of a table.
const BUILT_IN_HINTS: Record<string, string> = {
  service_type: "Shown when logging a session's Service Type.",
  service_status: "Shown when logging a session's Service Status.",
  location: "Shown when logging a session's Service Location.",
  group_size: "Shown when logging a session's Group Size Category.",
  company_affiliation: "Shown when logging a session's agency.",
};

function OptionCard({
  option,
  onSaved,
  onDeleted,
}: {
  option: DropdownOption;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = React.useState(false);
  const [code, setCode] = React.useState(option.code);
  const [label, setLabel] = React.useState(option.label);
  const [isSaving, setIsSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmPermanentDelete, setConfirmPermanentDelete] = React.useState(false);

  const handleSave = async () => {
    if (!code.trim() || !label.trim()) {
      showToast("Both a code and a name are required.", "error");
      return;
    }
    setIsSaving(true);
    try {
      await api.put(`/api/dropdown-options/${option.id}`, { code: code.trim(), label: label.trim() });
      setIsEditing(false);
      onSaved();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't save this option.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsSaving(true);
    try {
      await api.delete(`/api/dropdown-options/${option.id}`);
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't remove this option.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReactivate = async () => {
    setIsSaving(true);
    try {
      await api.put(`/api/dropdown-options/${option.id}/reactivate`);
      onSaved();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't reactivate this option.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Only ever offered for an already-deactivated, non-seeded (practitioner-
  // added) option — the backend separately refuses this for a seeded
  // default (is_seeded) or one still used on any existing log, returning a
  // clear error either way (see deleteDropdownOptionPermanently in
  // dropdownOptionsController.js).
  const handlePermanentDelete = async () => {
    setIsSaving(true);
    try {
      await api.delete(`/api/dropdown-options/${option.id}/permanent`);
      setConfirmPermanentDelete(false);
      onDeleted();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      // Dialog stays open on failure (e.g. "used on N logs") — the caller
      // needs to read the reason and then explicitly Cancel, matching the
      // pattern every other destructive action in this screen uses.
      showToast(body?.error || "Couldn't permanently delete this option.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="rounded-card border border-primary/40 bg-surface p-3">
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-20" disabled={isSaving} />
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" className="flex-1" disabled={isSaving} />
        </div>
        <div className="mt-2 flex justify-end gap-3">
          <button type="button" onClick={() => { setIsEditing(false); setCode(option.code); setLabel(option.label); }} disabled={isSaving} className="text-sm font-semibold text-ink-muted">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={isSaving} className="text-sm font-semibold text-primary">
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 rounded-card border border-border bg-surface p-3", !option.is_active && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink">{option.label}</p>
        <p className="truncate text-xs text-ink-faint">
          Code: {option.code}
          {!option.is_active && " · Removed"}
        </p>
      </div>
      {option.is_active ? (
        <>
          <button type="button" onClick={() => setIsEditing(true)} aria-label={`Edit ${option.label}`} className="press-scale flex size-9 items-center justify-center rounded-control text-ink-muted">
            <Pencil className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)} aria-label={`Remove ${option.label}`} className="press-scale flex size-9 items-center justify-center rounded-control text-danger">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleReactivate} disabled={isSaving} className="press-scale flex items-center gap-1 text-xs font-semibold text-primary">
            <RotateCcw className="size-3.5" aria-hidden="true" /> Reactivate
          </button>
          {/* Seeded defaults (EV, AS, IFSP, ...) never get this — only an
              option the practitioner added themselves can be permanently
              deleted, and only once it's already deactivated. */}
          {!option.is_seeded && (
            <button type="button" onClick={() => setConfirmPermanentDelete(true)} disabled={isSaving} className="press-scale flex items-center gap-1 text-xs font-semibold text-danger">
              <XCircle className="size-3.5" aria-hidden="true" /> Delete permanently
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove this option?"
        description={`"${option.label}" won't appear in the dropdown for new logs, but existing logs that used it will keep showing this name. This isn't permanent — you can bring it back anytime with Reactivate.`}
        confirmLabel="Remove"
        destructive
        loading={isSaving}
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={confirmPermanentDelete}
        onOpenChange={setConfirmPermanentDelete}
        title="Delete this option permanently?"
        description={`"${option.label}" will be completely removed — this can't be undone. Only possible if no existing log uses this code; if any do, you'll need to keep it deactivated instead.`}
        confirmLabel="Delete permanently"
        destructive
        loading={isSaving}
        onConfirm={handlePermanentDelete}
      />
    </div>
  );
}

function NewOptionCard({ category, onCreated, onCancel }: { category: string; onCreated: () => void; onCancel: () => void }) {
  const { showToast } = useToast();
  const [code, setCode] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  const handleSave = async () => {
    if (!code.trim() || !label.trim()) {
      showToast("Both a code and a name are required.", "error");
      return;
    }
    setIsSaving(true);
    try {
      await api.post("/api/dropdown-options", { category, code: code.trim(), label: label.trim() });
      onCreated();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't add this option.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-card border border-dashed border-primary/50 bg-surface-sunken p-3">
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-20" disabled={isSaving} autoFocus />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" className="flex-1" disabled={isSaving} />
      </div>
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} disabled={isSaving} className="text-sm font-semibold text-ink-muted">
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={isSaving} className="text-sm font-semibold text-primary">
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function NewCategoryCard({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { showToast } = useToast();
  const [displayName, setDisplayName] = React.useState("");
  const [isRequired, setIsRequired] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  const handleSave = async () => {
    if (!displayName.trim()) {
      showToast("A category name is required.", "error");
      return;
    }
    setIsSaving(true);
    try {
      await api.post("/api/dropdown-options/categories", { displayName: displayName.trim(), isRequiredOnLog: isRequired });
      onCreated();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't add this category.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-card border border-dashed border-primary/50 bg-surface-sunken p-3.5">
      <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Category name, e.g. Insurance Type" disabled={isSaving} autoFocus />
      <button
        type="button"
        role="checkbox"
        aria-checked={isRequired}
        onClick={() => setIsRequired((v) => !v)}
        className="press-scale mt-3 flex items-center gap-2.5"
      >
        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-[6px] border-2", isRequired ? "border-primary bg-primary" : "border-border bg-transparent")} aria-hidden="true">
          {isRequired && <Check className="size-3.5 text-primary-fg" />}
        </span>
        <span className="text-sm text-ink">Required when logging a session</span>
      </button>
      <div className="mt-3 flex justify-end gap-3">
        <button type="button" onClick={onCancel} disabled={isSaving} className="text-sm font-semibold text-ink-muted">
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={isSaving} className="text-sm font-semibold text-primary">
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function DropdownOptionsManager() {
  const { showToast } = useToast();
  const { dropdownOptions, dropdownCategories, fetchDropdownOptions } = useAppData();
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
  const [isAddingOption, setIsAddingOption] = React.useState(false);
  const [isAddingCategory, setIsAddingCategory] = React.useState(false);
  const [confirmDeleteCategory, setConfirmDeleteCategory] = React.useState(false);
  const [isDeletingCategory, setIsDeletingCategory] = React.useState(false);

  const current = activeCategory
    ? dropdownCategories.find((c) => c.key === activeCategory)
    : dropdownCategories[0];
  const resolvedKey = current?.key ?? null;

  const handleDeleteCategory = async () => {
    if (!current) return;
    setIsDeletingCategory(true);
    try {
      await api.delete(`/api/dropdown-options/categories/${current.id}`);
      setConfirmDeleteCategory(false);
      setActiveCategory(null);
      await fetchDropdownOptions();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't delete this category.", "error");
    } finally {
      setIsDeletingCategory(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Dropdown Options" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <p className="mb-4 text-sm text-ink-muted">
          Add, rename, or remove the choices you pick from when logging a session. Renaming updates everywhere immediately, including past logs. Removing hides a choice from new logs but keeps it on past ones.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {dropdownCategories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCategory(cat.key)}
              className={cn(
                "press-scale rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                resolvedKey === cat.key ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-ink-muted"
              )}
            >
              {cat.display_name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIsAddingCategory(true)}
            aria-label="Add a new dropdown category"
            className="press-scale flex size-9 items-center justify-center rounded-full border border-dashed border-primary/50 text-primary"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>

        {isAddingCategory && (
          <div className="mb-4">
            <NewCategoryCard
              onCreated={async () => {
                setIsAddingCategory(false);
                await fetchDropdownOptions();
              }}
              onCancel={() => setIsAddingCategory(false)}
            />
          </div>
        )}

        {current && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs text-ink-faint">
                {BUILT_IN_HINTS[current.key] || `Shown when logging a session's ${current.display_name}.`}
              </p>
              {current.is_custom && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteCategory(true)}
                  className="flex shrink-0 items-center gap-1 pl-2 text-xs font-semibold text-danger"
                >
                  <X className="size-3.5" aria-hidden="true" /> Delete category
                </button>
              )}
            </div>

            <div className="space-y-2">
              {(dropdownOptions[current.key] || []).map((option) => (
                <OptionCard key={option.id} option={option} onSaved={fetchDropdownOptions} onDeleted={fetchDropdownOptions} />
              ))}

              {isAddingOption ? (
                <NewOptionCard
                  category={current.key}
                  onCreated={async () => {
                    setIsAddingOption(false);
                    await fetchDropdownOptions();
                  }}
                  onCancel={() => setIsAddingOption(false)}
                />
              ) : (
                <Button variant="outline" className="w-full" onClick={() => setIsAddingOption(true)}>
                  <Plus className="size-4" aria-hidden="true" /> Add option
                </Button>
              )}
            </div>
          </>
        )}

        <ConfirmDialog
          open={confirmDeleteCategory}
          onOpenChange={setConfirmDeleteCategory}
          title="Delete this category?"
          description={current ? `Delete the "${current.display_name}" category? This can't be undone.` : ""}
          confirmLabel="Delete"
          destructive
          loading={isDeletingCategory}
          onConfirm={handleDeleteCategory}
        />
      </div>
    </PushScreen>
  );
}
