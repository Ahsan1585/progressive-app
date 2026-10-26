import { CalendarClock, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Changing the date on a note the parent already signed sends it to the
// parent to re-sign (backend: utils/dateChangeResign.js). Shared by Edit Log
// and Resubmit.

export const RESIGN_BUTTON_LABEL = "Send to parent to re-sign";

export const sameDay = (a?: string | null, b?: string | null) => (a || "").slice(0, 10) === (b || "").slice(0, 10);

export function DateChangeNotice() {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-[14px] border-2 border-info-border bg-info-bg px-3.5 py-3 text-info">
      <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <p className="text-[15px] font-semibold leading-snug">
        Changing the date needs the parent&apos;s new signature. We&apos;ll email them a link, and the note is held from billing until they sign.
      </p>
    </div>
  );
}

// Centered (not a toast): the practitioner needs to know the note is now
// waiting on the parent, not saved.
export function ResignSentDialog({ parentEmail, onDone }: { parentEmail: string | null; onDone: () => void }) {
  return (
    <Dialog open={parentEmail !== null} onOpenChange={(open) => { if (!open) onDone(); }}>
      <DialogContent aria-labelledby="resign-sent-title">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-info-bg text-info">
          <Send className="size-6" aria-hidden="true" />
        </div>
        <DialogTitle id="resign-sent-title" className="text-center text-[20px] font-extrabold">Sent to the parent to re-sign</DialogTitle>
        <DialogDescription className="mt-2 text-center text-[15px] text-ink-body">
          We emailed a link to <b className="break-all text-ink">{parentEmail}</b>. The note is held from billing until they sign the new date.
          You can resend the link or undo the change from the child&apos;s page.
        </DialogDescription>
        <Button className="mt-5 h-[52px] w-full text-[17px] font-bold" onClick={onDone}>OK</Button>
      </DialogContent>
    </Dialog>
  );
}
