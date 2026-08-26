import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface TelepracticeSentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentEmail?: string | null;
}

// Shown after a telepractice session is submitted. A centered modal instead
// of a toast — unlike a normal "Encounter saved." confirmation, this one
// means the session is NOT fully logged yet (it's still awaiting the
// parent's remote signature before it can be confirmed and submitted), so
// the practitioner needs to actually read and register that, not just
// glimpse a toast in the corner.
export function TelepracticeSentDialog({ open, onOpenChange, parentEmail }: TelepracticeSentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="telepractice-sent-dialog-title">
        <DialogHeader>
          <DialogTitle id="telepractice-sent-dialog-title">Signing link sent</DialogTitle>
          <DialogDescription>
            {parentEmail ? `A signing link was sent to ${parentEmail}.` : "A signing link was sent to the parent."}{" "}
            You&apos;ll see this session in your Inbox once they sign it, so you can confirm and submit it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
