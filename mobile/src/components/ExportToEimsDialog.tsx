import { Copy, FileText, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate, formatTime12h } from "@/utils/time";
import type { Assessment } from "@/types";

interface ExportToEimsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Assessment | null;
  serviceTypeLabel: string;
  statusLabel: string;
  locationLabel: string;
  groupSizeLabel: string | null;
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

// Independent-practitioner-only — EIMS is the state's own data-entry portal;
// this app has no API integration into it (and isn't meant to — EIMS is a
// state system this app doesn't own). This dialog just lays out one
// session's data exactly how EIMS's own fields are labeled, with a one-tap
// "Copy all" so the practitioner can paste it in while filling out the
// state form themselves, instead of flipping back and forth re-reading
// values off the session card.
export function ExportToEimsDialog({
  open, onOpenChange, session, serviceTypeLabel, statusLabel, locationLabel, groupSizeLabel,
}: ExportToEimsDialogProps) {
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
      <DialogContent aria-labelledby="export-eims-dialog-title" className="max-h-[80vh] overflow-y-auto">
        <DialogClose
          aria-label="Close"
          className="press-scale absolute right-3 top-3 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
        <DialogHeader className="pr-8">
          <DialogTitle id="export-eims-dialog-title">Export to EIMS</DialogTitle>
          <DialogDescription>
            Copy this session's details, then paste them into the state EIMS portal while logging in yourself.
          </DialogDescription>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
