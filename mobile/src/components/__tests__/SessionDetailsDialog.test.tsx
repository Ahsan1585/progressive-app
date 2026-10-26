// Tapping a scheduled session on Home shows its details in a popup.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionDetailsDialog } from "../SessionDetailsDialog";
import type { ScheduledSession } from "@/types";

beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 25, 9, 0), toFake: ["Date"] })); // Sun, Oct 25 2026
afterEach(() => vi.useRealTimers());

const session = (over: Partial<ScheduledSession> = {}): ScheduledSession => ({
  id: "s1", patient_id: "p1", practitioner_id: "7", patient_first_name: "luz", patient_last_name: "quintero",
  session_date: "2026-10-28T00:00:00.000Z", start_time: "14:00:00", end_time: "15:00:00",
  location: "in the office", notes: "Bring the stacking cups", status: "scheduled", parent_notified_at: "2026-10-20T12:00:00Z",
  ...over,
});

const open = (s: ScheduledSession | null, handlers: Partial<{ onOpenChild: () => void; onLogSession: () => void }> = {}) =>
  render(<SessionDetailsDialog session={s} onOpenChange={vi.fn()} onOpenChild={handlers.onOpenChild ?? vi.fn()} onLogSession={handlers.onLogSession ?? vi.fn()} />);

describe("SessionDetailsDialog", () => {
  it("shows the child, day, time with length, location, note and invite status", () => {
    open(session());
    expect(screen.getByRole("heading", { name: "Luz Quintero" })).toBeInTheDocument();
    expect(screen.getByText("Wednesday, October 28")).toBeInTheDocument();
    expect(screen.getByText("2:00 – 3:00 PM")).toBeInTheDocument();
    expect(screen.getByText("1 hr")).toBeInTheDocument();
    expect(screen.getByText("in the office")).toBeInTheDocument();
    expect(screen.getByText("Bring the stacking cups")).toBeInTheDocument();
    expect(screen.getByText(/Calendar invite sent to the parent/)).toBeInTheDocument();
  });

  it("says when no invite went out and leaves out empty location and note", () => {
    open(session({ location: null, notes: null, parent_notified_at: null }));
    expect(screen.getByText(/No calendar invite sent/)).toBeInTheDocument();
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
    expect(screen.queryByText("Note")).not.toBeInTheDocument();
  });

  it("opens the child's page; no directions button", () => {
    const onOpenChild = vi.fn();
    open(session(), { onOpenChild });
    fireEvent.click(screen.getByRole("button", { name: "Open Luz's page" }));
    expect(onOpenChild).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /directions|navigate/i })).not.toBeInTheDocument();
  });

  it("offers Log this session only on the day of the session", () => {
    const { unmount } = open(session());
    expect(screen.queryByRole("button", { name: "Log this session" })).not.toBeInTheDocument();
    unmount();
    const onLogSession = vi.fn();
    open(session({ session_date: "2026-10-25T00:00:00.000Z", start_time: "09:30:00", end_time: "10:15:00" }), { onLogSession });
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("45 min")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log this session" }));
    expect(onLogSession).toHaveBeenCalled();
  });
});
