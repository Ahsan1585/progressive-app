import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface IdleWarningOverlayProps {
  open: boolean;
  secondsRemaining: number;
  onStayLoggedIn: () => void;
}

// Global overlay, can appear over any authenticated screen (design flow 12).
// Countdown is announced via an assertive live region so a screen-reader
// user isn't silently logged out (a11y notes).
export function IdleWarningOverlay({ open, secondsRemaining, onStayLoggedIn }: IdleWarningOverlayProps) {
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const display = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <Dialog open={open}>
      <DialogContent
        aria-labelledby="idle-warning-title"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle id="idle-warning-title">You'll be logged out soon</DialogTitle>
          <DialogDescription>
            Due to inactivity, you'll be logged out in{" "}
            <span aria-live="assertive" className="tabular font-semibold text-ink">
              {display}
            </span>{" "}
            to protect patient information.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onStayLoggedIn} className="w-full sm:w-auto">
            Stay logged in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
