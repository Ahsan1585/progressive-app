import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MAX_DRAFTS_PER_PATIENT } from "@/constants/drafts";

interface DraftCapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientName?: string;
}

// Shown when a practitioner tries to start a new log for a child that
// already has MAX_DRAFTS_PER_PATIENT saved drafts. A centered modal instead
// of a toast — the block needs to actually be seen and understood, not
// flash past in a corner.
export function DraftCapDialog({ open, onOpenChange, patientName }: DraftCapDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="draft-cap-dialog-title">
        <DialogHeader>
          <DialogTitle id="draft-cap-dialog-title">{MAX_DRAFTS_PER_PATIENT} drafts already in progress</DialogTitle>
          <DialogDescription>
            {patientName ? `${patientName} already has` : "This child already has"} {MAX_DRAFTS_PER_PATIENT} saved drafts.
            Finish or discard one before starting another.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
