import { Copy, MessageSquare, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate } from "@/utils/time";
import type { LogNote } from "@/types";

interface ViewNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: LogNote[];
  loading: boolean;
}

const authorLabel = (n: LogNote) => {
  const name = [n.first_name, n.last_name].filter(Boolean).join(" ");
  if (name) return name;
  // Falls back to the role when the authoring account no longer exists
  // (see LogNote's own comment) — "Billing", "Practitioner", etc.
  return n.author_role.charAt(0).toUpperCase() + n.author_role.slice(1);
};

const notesToPlainText = (notes: LogNote[]) =>
  notes.map((n) => `${authorLabel(n)} (${formatSafeDate(n.created_at)}):\n${n.note}`).join("\n\n");

// Read-only comment-thread viewer for one session log (assessment_notes),
// with a one-tap "Copy all" so the practitioner can paste the full thread
// elsewhere (e.g. into an email to an agency) without retyping it.
export function ViewNotesDialog({ open, onOpenChange, notes, loading }: ViewNotesDialogProps) {
  const { showToast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(notesToPlainText(notes));
      showToast("Comments copied.");
    } catch {
      showToast("Couldn't copy. Please try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="view-notes-dialog-title" className="relative max-h-[80vh] overflow-y-auto">
        <DialogClose
          aria-label="Close"
          className="press-scale absolute right-3 top-3 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
        <DialogHeader className="pr-8">
          <DialogTitle id="view-notes-dialog-title">Comments</DialogTitle>
        </DialogHeader>

        {loading ? (
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

        {!loading && notes.length > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={handleCopy} className="flex items-center gap-2">
              <Copy className="size-4" aria-hidden="true" />
              Copy all
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
