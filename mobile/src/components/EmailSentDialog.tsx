import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface EmailSentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agencyName: string | null;
  agencyEmail: string;
  includesInvoice: boolean;
}

// Shown after a generated SEVF (and invoice) is emailed to an agency — a
// centered modal the practitioner must explicitly dismiss (OK), not a toast
// that can be missed, since this confirms a real document left the app to a
// specific outside recipient and the exact company/address is worth
// actually reading, not just glimpsing. Same pattern as
// TelepracticeSentDialog's "this needs to be read, not glanced at" modal.
export function EmailSentDialog({ open, onOpenChange, agencyName, agencyEmail, includesInvoice }: EmailSentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="email-sent-dialog-title">
        <DialogHeader>
          <DialogTitle id="email-sent-dialog-title">Email sent</DialogTitle>
          <DialogDescription>
            The SEVF{includesInvoice ? " and invoice were" : " was"} emailed to{" "}
            {agencyName ? <span className="font-semibold text-ink">{agencyName}</span> : "the agency"} at{" "}
            <span className="font-semibold text-ink">{agencyEmail}</span>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
