// Pure idle-state calculation, kept separate from the hook/timer plumbing so
// it's trivially testable. Mirrors frontend/src/App.jsx's IdleLogout timing
// (15 min) with the mobile-only 13-minute warning addition (design flow 12).

export const IDLE_WARNING_MS = 13 * 60 * 1000; // 13 minutes
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export type IdlePhase = "active" | "warning" | "expired";

export interface IdleState {
  phase: IdlePhase;
  /** Seconds remaining until logout; only meaningful during "warning". */
  secondsUntilLogout: number;
}

export const computeIdleState = (lastActiveMs: number, nowMs: number): IdleState => {
  const elapsed = nowMs - lastActiveMs;

  if (elapsed >= IDLE_TIMEOUT_MS) {
    return { phase: "expired", secondsUntilLogout: 0 };
  }

  if (elapsed >= IDLE_WARNING_MS) {
    const secondsUntilLogout = Math.max(0, Math.ceil((IDLE_TIMEOUT_MS - elapsed) / 1000));
    return { phase: "warning", secondsUntilLogout };
  }

  return { phase: "active", secondsUntilLogout: Math.ceil((IDLE_TIMEOUT_MS - elapsed) / 1000) };
};
