import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DuplicateLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message?: string;
}

// Shown when the server rejects a submission because an identical session log
// already exists — same child, service date, service type, and start/end
// time. A centered modal rather than the inline error banner: this is a hard
// block the practitioner needs to read and understand, not a field they can
// correct and retry.
export function DuplicateLogDialog({ open, onOpenChange, message }: DuplicateLogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="duplicate-log-dialog-title">
        <DialogHeader>
          <DialogTitle id="duplicate-log-dialog-title">This session is already logged</DialogTitle>
          <DialogDescription>
            {message ||
              "A log for this session has already been submitted. You can't submit the same session for the same child, date, service, and time twice."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
