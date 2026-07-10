import { describe, it, expect } from "vitest";
import { computeIdleState, IDLE_WARNING_MS, IDLE_TIMEOUT_MS } from "./idle";

describe("computeIdleState", () => {
  const lastActive = 1_000_000;

  it("is active well before the warning threshold", () => {
    const state = computeIdleState(lastActive, lastActive + 60_000);
    expect(state.phase).toBe("active");
    expect(state.secondsUntilLogout).toBeGreaterThan(0);
  });

  it("enters the warning phase exactly at 13 minutes idle", () => {
    const state = computeIdleState(lastActive, lastActive + IDLE_WARNING_MS);
    expect(state.phase).toBe("warning");
  });

  it("counts down the remaining seconds during the warning window", () => {
    const state = computeIdleState(lastActive, lastActive + IDLE_WARNING_MS + 30_000);
    expect(state.phase).toBe("warning");
    expect(state.secondsUntilLogout).toBe(90); // 2 min warning - 30s elapsed
  });

  it("expires exactly at 15 minutes idle", () => {
    const state = computeIdleState(lastActive, lastActive + IDLE_TIMEOUT_MS);
    expect(state.phase).toBe("expired");
  });

  it("stays expired well beyond 15 minutes (e.g. a long background gap)", () => {
    const state = computeIdleState(lastActive, lastActive + IDLE_TIMEOUT_MS + 60 * 60_000);
    expect(state.phase).toBe("expired");
  });
});
