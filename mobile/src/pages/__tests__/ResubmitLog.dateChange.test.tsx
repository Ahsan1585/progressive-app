// A returned note's date can be corrected on Resubmit, with the parent's new signature.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn() }));
vi.mock("@/api/axiosInstance", () => ({ default: api }));
const fetchRejectedLogs = vi.fn();
const opt = (code: string, label: string) => ({ id: 1, category: "x", code, label, sort_order: 0, is_active: true });
vi.mock("@/contexts/AppDataContext", () => ({
  useAppData: () => ({
    rejectedLogs: [{
      id: 5, service_date: "2026-10-20", start_time: "09:00", end_time: "10:00", status: "1", type: "SLP", location: "1",
      group_size_category: "individual", form_data: { custom_fields: {} }, rejection_note: "Wrong date", rejected_at: "2026-10-24",
    }],
    fetchRejectedLogs, profile: { service_types: [] },
    serviceTypeOptions: [opt("SLP", "Speech")], statusOptions: [opt("1", "Direct")], locationOptions: [opt("1", "Home")],
    groupSizeOptions: [opt("individual", "Individual")], dropdownOptions: {}, dropdownCategories: [],
  }),
}));
const showToast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast }) }));

import ResubmitLog from "../ResubmitLog";

const renderIt = () => render(
  <MemoryRouter initialEntries={["/inbox/5/resubmit"]}>
    <Routes>
      <Route path="/inbox/:id/resubmit" element={<ResubmitLog />} />
      <Route path="/inbox" element={<div>inbox page</div>} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => { api.post.mockReset(); showToast.mockReset(); fetchRejectedLogs.mockReset(); });

describe("Resubmit with a corrected date", () => {
  it("shows the date; unchanged, it resubmits as before", async () => {
    api.post.mockResolvedValue({ data: { success: true } });
    renderIt();
    expect(screen.getByLabelText("Session date")).toHaveValue("2026-10-20");
    fireEvent.click(screen.getByRole("button", { name: "Resubmit for review" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][1]).toMatchObject({ assessmentId: 5, service_date: "2026-10-20" });
    expect(showToast).toHaveBeenCalledWith("Log resubmitted for review.");
  });

  it("a new date goes to the parent to re-sign first", async () => {
    api.post.mockResolvedValue({ data: { success: true, resignRequested: true, parentEmail: "p@example.com" } });
    renderIt();
    fireEvent.change(screen.getByLabelText("Session date"), { target: { value: "2026-10-22" } });
    expect(screen.getByText(/parent's new signature/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send to parent to re-sign" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][1]).toMatchObject({ service_date: "2026-10-22" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("p@example.com");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await screen.findByText("inbox page")).toBeInTheDocument();
  });
});
