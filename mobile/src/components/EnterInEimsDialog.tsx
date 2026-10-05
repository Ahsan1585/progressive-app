import { Copy, FileText, MessageSquare, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate, formatTime12h } from "@/utils/time";
import type { Assessment, LogNote } from "@/types";

interface EnterInEimsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Assessment | null;
  serviceTypeLabel: string;
  statusLabel: string;
  locationLabel: string;
  groupSizeLabel: string | null;
  notes: LogNote[];
  notesLoading: boolean;
  // false for a tenant-company practitioner — EIMS is an independent-
  // practitioner-only concept, so that role sees only the Comments section
  // below, reusing this same dialog/fetch rather than a second component.
  showEimsFields?: boolean;
}

// One field exactly as EIMS's own data-entry screen expects it — label text
// matches FIELD_TO_MAPPING_KEY's own field labels in billingController.js
// (the office-side EIMS-reconciliation code already treats these as EIMS's
// canonical field names), so a practitioner reading this dialog sees the
// same names they'll find on the state portal's own form.
interface EimsField {
  label: string;
  value: string;
}

function buildFields(
  session: Assessment,
  serviceTypeLabel: string,
  statusLabel: string,
  locationLabel: string,
  groupSizeLabel: string | null
): EimsField[] {
  const childName = [session.patient_first_name, session.patient_last_name].filter(Boolean).join(" ");
  const practitionerName = [session.practitioner_first_name, session.practitioner_last_name].filter(Boolean).join(" ");
  const fields: EimsField[] = [
    { label: "Child Name", value: childName || "—" },
    { label: "Child ID", value: session.patient_id ? String(session.patient_id) : "—" },
    { label: "Practitioner", value: practitionerName || "—" },
    { label: "Service Date", value: formatSafeDate(session.service_date) },
    { label: "Start Time", value: session.start_time ? formatTime12h(session.start_time) : "—" },
    { label: "End Time", value: session.end_time ? formatTime12h(session.end_time) : "—" },
    { label: "Service Type", value: serviceTypeLabel },
    { label: "Visit Status", value: statusLabel },
    { label: "Location", value: locationLabel },
  ];
  if (groupSizeLabel) fields.push({ label: "Group Size", value: groupSizeLabel });
  return fields;
}

const fieldsToPlainText = (fields: EimsField[]) => fields.map((f) => `${f.label}: ${f.value}`).join("\n");

const authorLabel = (n: LogNote) => {
  const name = [n.first_name, n.last_name].filter(Boolean).join(" ");
  if (name) return name;
  return n.author_role.charAt(0).toUpperCase() + n.author_role.slice(1);
};

// Independent-practitioner-only — "Enter in EIMS" (formerly "Export to
// EIMS"). EIMS is the state's own data-entry portal; this app has no API
// integration into it (and isn't meant to — EIMS is a state system this app
// doesn't own). This dialog lays out one session's data exactly how EIMS's
// own fields are labeled, with a one-tap "Copy all" so the practitioner can
// paste it in while filling out the state form themselves, instead of
// flipping back and forth re-reading values off the session card. Also
// folds in the session's comment thread (formerly its own separate "View
// comments" popup) — both are reference material for the same task of
// entering/describing this session elsewhere, so they live together now.
export function EnterInEimsDialog({
  open, onOpenChange, session, serviceTypeLabel, statusLabel, locationLabel, groupSizeLabel,
  notes, notesLoading, showEimsFields = true,
}: EnterInEimsDialogProps) {
  const { showToast } = useToast();
  const fields = session ? buildFields(session, serviceTypeLabel, statusLabel, locationLabel, groupSizeLabel) : [];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fieldsToPlainText(fields));
      showToast("Session details copied.");
    } catch {
      showToast("Couldn't copy. Please try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="enter-eims-dialog-title" className="max-h-[80vh] overflow-y-auto">
        <DialogClose
          aria-label="Close"
          className="press-scale absolute right-3 top-3 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
        <DialogHeader className="pr-8">
          <DialogTitle id="enter-eims-dialog-title">{showEimsFields ? "Enter in EIMS" : "Comments"}</DialogTitle>
          {showEimsFields && (
            <DialogDescription>
              Copy this session's details, then paste them into the state EIMS portal while logging in yourself.
            </DialogDescription>
          )}
        </DialogHeader>

        {showEimsFields && (
          <>
            <dl className="divide-y divide-border rounded-card border border-border bg-surface-sunken">
              {fields.map((f) => (
                <div key={f.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-faint">{f.label}</dt>
                  <dd className="truncate text-sm font-medium text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>

            <DialogFooter>
              <Button onClick={handleCopy} className="flex items-center gap-2">
                <Copy className="size-4" aria-hidden="true" />
                Copy all
              </Button>
            </DialogFooter>

            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint">
              <FileText className="size-3.5 shrink-0" aria-hidden="true" />
              This app has no direct connection to EIMS — you'll still need to log in and enter it there yourself.
            </p>
          </>
        )}

        <div className={showEimsFields ? "mt-5 border-t border-border pt-4" : ""}>
          {showEimsFields && <p className="mb-2 text-[13px] font-semibold text-ink">Comments</p>}
          {notesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : notes.length === 0 ? (
            <EmptyState icon={MessageSquare} heading="No comments" subtext="Nothing has been added to this session yet." />
          ) : (
            <ul role="list" className="space-y-3">
              {notes.map((n, i) => (
                <li key={i} className="rounded-card border border-border bg-surface-sunken p-3">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{authorLabel(n)}</p>
                    <p className="shrink-0 text-xs text-ink-faint">{formatSafeDate(n.created_at)}</p>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ink-body">{n.note}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
