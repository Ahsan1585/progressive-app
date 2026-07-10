import { useCallback, useEffect, useRef, useState } from "react";
import { computeIdleState, type IdlePhase } from "@/utils/idle";

const LAST_ACTIVE_KEY = "mobile:lastActiveAt";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

interface UseIdleTimerOptions {
  /** Only tracks/ticks while true — e.g. only once fully authenticated. */
  enabled: boolean;
  /** Called exactly once when the idle phase crosses into "expired". */
  onExpire: () => void;
}

interface UseIdleTimerResult {
  phase: IdlePhase;
  secondsUntilLogout: number;
  /** Explicit "Stay logged in" action — resets the timer and dismisses the warning. */
  reset: () => void;
}

// Idle auto-logout (story 9) + the mobile-only 13-minute warning (design flow 12).
// Backgrounding is handled by persisting the last-active timestamp to
// localStorage on every activity tick and re-reading it on resume, so elapsed
// background time counts toward the 15-minute timeout even if the JS timer
// itself was suspended while backgrounded.
export function useIdleTimer({ enabled, onExpire }: UseIdleTimerOptions): UseIdleTimerResult {
  const lastActiveRef = useRef<number>(Date.now());
  const [phase, setPhase] = useState<IdlePhase>("active");
  const [secondsUntilLogout, setSecondsUntilLogout] = useState(0);
  const expiredRef = useRef(false);

  const reset = useCallback(() => {
    lastActiveRef.current = Date.now();
    localStorage.setItem(LAST_ACTIVE_KEY, String(lastActiveRef.current));
    expiredRef.current = false;
    setPhase("active");
  }, []);

  useEffect(() => {
    if (!enabled) return;

    reset();

    // In-memory update is cheap and happens on every event; the localStorage
    // write (needed for the backgrounding case) is throttled so a flurry of
    // mousemove/scroll events can't cause layout-thread jank.
    let lastPersist = Date.now();
    const PERSIST_INTERVAL_MS = 2000;
    const markActive = () => {
      const now = Date.now();
      lastActiveRef.current = now;
      if (now - lastPersist >= PERSIST_INTERVAL_MS) {
        lastPersist = now;
        localStorage.setItem(LAST_ACTIVE_KEY, String(now));
      }
    };

    const tick = () => {
      const state = computeIdleState(lastActiveRef.current, Date.now());
      setPhase(state.phase);
      setSecondsUntilLogout(state.secondsUntilLogout);
      if (state.phase === "expired" && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Flush immediately on backgrounding, bypassing the throttle, so the
        // elapsed background time is measured from an accurate timestamp.
        localStorage.setItem(LAST_ACTIVE_KEY, String(lastActiveRef.current));
      } else if (document.visibilityState === "visible") {
        // Reconcile against the persisted timestamp in case time passed
        // while this tab/app was backgrounded and timers were suspended.
        const stored = localStorage.getItem(LAST_ACTIVE_KEY);
        const storedMs = stored ? parseInt(stored, 10) : NaN;
        if (!isNaN(storedMs) && storedMs < lastActiveRef.current) {
          lastActiveRef.current = storedMs;
        }
        tick();
      }
    };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = window.setInterval(tick, 1000);
    tick();

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActive));
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(interval);
    };
  }, [enabled, onExpire, reset]);

  return { phase, secondsUntilLogout, reset };
}
