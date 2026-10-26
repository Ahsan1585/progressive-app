// Scheduling a session in a few big taps: a day, a start time, a length.
// The end time is worked out; the request sent is the same as before.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }));
vi.mock("@/api/axiosInstance", () => ({ default: api }));
const showToast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast }) }));

import { ScheduleSessionSheet } from "../ScheduleSessionSheet";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 25, 9, 0), toFake: ["Date"] }); // Sun, Oct 25 2026
  api.post.mockReset().mockResolvedValue({ data: { success: true } });
  api.patch.mockReset().mockResolvedValue({ data: { success: true } });
  showToast.mockReset();
});
afterEach(() => vi.useRealTimers());

const open = (props: Partial<React.ComponentProps<typeof ScheduleSessionSheet>> = {}) =>
  render(<ScheduleSessionSheet target="new" patientId="p1" parentEmail="luz.parent@example.com" onOpenChange={vi.fn()} onSaved={vi.fn()} {...props} />);

describe("Schedule a session", () => {
  it("says where the invite goes, and that there is no invite without a parent email", () => {
    const { unmount } = open();
    expect(screen.getByText(/luz\.parent@example\.com/)).toBeInTheDocument();
    unmount();
    open({ parentEmail: null });
    expect(screen.getByText(/No parent email on file/)).toBeInTheDocument();
  });

  it("day, start time and length are enough; the end time is worked out", async () => {
    const onSaved = vi.fn();
    open({ onSaved });
    fireEvent.click(screen.getByRole("radio", { name: /Tomorrow/ }));
    fireEvent.click(screen.getByRole("radio", { name: "10:00 AM" }));
    fireEvent.click(screen.getByRole("radio", { name: "45 min" }));
    fireEvent.click(screen.getByRole("radio", { name: "Home" }));
    const save = screen.getByRole("button", { name: /Schedule · Mon, Oct 26 · 10:00 – 10:45 AM/ });
    fireEvent.click(save);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith("/api/schedule", {
      patientId: "p1", sessionDate: "2026-10-26", startTime: "10:00", endTime: "10:45", location: "Home", notes: "",
    });
    expect(showToast).toHaveBeenCalledWith("Session scheduled.");
    expect(onSaved).toHaveBeenCalled();
  });

  it("60 minutes is the default length", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Today/ }));
    fireEvent.click(screen.getByRole("radio", { name: "2:30 PM" }));
    expect(screen.getByRole("button", { name: /Schedule · Today · 2:30 – 3:30 PM/ })).toBeInTheDocument();
  });

  it("the button says what is missing until a day and time are picked", () => {
    open();
    expect(screen.getByRole("button", { name: "Pick a day and a start time" })).toBeDisabled();
  });

  it("rescheduling opens with the session already filled in and saves with PATCH", async () => {
    open({
      target: { id: "s9", patient_id: "p1", practitioner_id: "7", session_date: "2026-10-28T00:00:00.000Z", start_time: "09:30:00", end_time: "10:00:00", location: "Clinic", notes: "Bring blocks", status: "scheduled", parent_notified_at: null },
    });
    expect(screen.getByRole("heading", { name: "Reschedule session" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "30 min" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "11:00 AM" }));
    fireEvent.click(screen.getByRole("button", { name: /Save · Wed, Oct 28 · 11:00 – 11:30 AM/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/api/schedule/s9", {
      sessionDate: "2026-10-28", startTime: "11:00", endTime: "11:30", location: "Clinic", notes: "Bring blocks",
    }));
  });
});
