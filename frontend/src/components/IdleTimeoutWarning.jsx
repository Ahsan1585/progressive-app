import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes of inactivity before warning
const COUNTDOWN_MS = 3 * 60 * 1000; // 3 minutes to respond before auto-logout
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

const formatCountdown = (ms) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

// Auto-logs out an idle office-staff session: 15 minutes of no mouse/keyboard/
// touch/scroll activity triggers a warning dialog with a 3-minute countdown,
// after which the session is cleared. Once the warning is showing, passive
// activity (e.g. an accidental mouse nudge) does NOT dismiss it — only the
// explicit "Stay Logged In" click does, since the whole point is to catch
// someone who's actually walked away from a still-logged-in office computer.
export const IdleTimeoutWarning = ({ onLogout }) => {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingMs, setRemainingMs] = useState(COUNTDOWN_MS);
  const lastActivityRef = useRef(Date.now());
  const warningRef = useRef(false); // mirrors showWarning for use inside the interval closure

  useEffect(() => {
    // Ignored once the warning is showing — see the component-level note
    // above; lastActivityRef doubles as the countdown's start point while
    // the warning is up, so passive activity must not touch it.
    const registerActivity = () => {
      if (warningRef.current) return;
      lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, registerActivity, { passive: true }));

    const interval = setInterval(() => {
      const now = Date.now();
      if (!warningRef.current) {
        if (now - lastActivityRef.current >= IDLE_LIMIT_MS) {
          warningRef.current = true;
          setShowWarning(true);
          setRemainingMs(COUNTDOWN_MS);
          lastActivityRef.current = now; // countdown start point
        }
        return;
      }
      const remaining = COUNTDOWN_MS - (now - lastActivityRef.current);
      if (remaining <= 0) {
        clearInterval(interval);
        onLogout();
        return;
      }
      setRemainingMs(remaining);
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, registerActivity));
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStayLoggedIn = () => {
    warningRef.current = false;
    setShowWarning(false);
    lastActivityRef.current = Date.now();
  };

  return (
    <Dialog open={showWarning} onOpenChange={(open) => { if (!open) handleStayLoggedIn(); }}>
      <DialogContent
        className="sm:max-w-sm bg-white"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Still there?</DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-sm text-slate-600 -mt-2">
          You've been inactive for a while. For security, you'll be signed out in{' '}
          <span className="font-mono font-bold text-slate-900">{formatCountdown(remainingMs)}</span> unless you stay logged in.
        </DialogDescription>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onLogout} className="cursor-pointer">
            Log Out Now
          </Button>
          <Button type="button" onClick={handleStayLoggedIn} className="cursor-pointer bg-slate-800 hover:bg-slate-900 text-white">
            Stay Logged In
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
