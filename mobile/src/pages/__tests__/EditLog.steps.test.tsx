// Edit Log uses the same big, bold steps as Log Session (Details, Codes,
// Notes), starts from the note's saved values, and saves the same payload.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/api/axiosInstance", () => ({ default: api }));
const opt = (code: string, label: string) => ({ id: 1, category: "x", code, label, sort_order: 0, is_active: true });
vi.mock("@/contexts/AppDataContext", () => ({
  useAppData: () => ({
    profile: { service_types: ["SLP", "DI"] },
    serviceTypeOptions: [opt("SLP", "Speech Language Therapy"), opt("DI", "Developmental Intervention")],
    statusOptions: [opt("1", "Direct Child Service"), opt("3", "Family Cancelled")],
    locationOptions: [opt("1", "Home"), opt("8", "Phone/Video Conferencing")],
    groupSizeOptions: [opt("individual", "Direct Child Service - Individual")],
    dropdownOptions: {}, dropdownCategories: [],
  }),
}));
const showToast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast }) }));

import EditLog from "../EditLog";

const log = {
  id: 41, billing_status: "pending", service_date: "2026-10-20", start_time: "19:49", end_time: "20:49",
  status: "1", type: "SLP", location: "1", group_size_category: "individual",
  form_data: { custom_fields: {} }, session_notes: "We made some wonderful progress today.",
};

const renderEdit = () =>
  render(
    <MemoryRouter initialEntries={["/patients/p1/logs/41/edit"]}>
      <Routes>
        <Route path="/patients/:id/logs/:logId/edit" element={<EditLog />} />
        <Route path="/patients/:id" element={<div>child page</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  api.get.mockReset(); api.put.mockReset(); showToast.mockReset();
  api.get.mockResolvedValue({ data: [log] });
  api.put.mockResolvedValue({ data: { success: true } });
});

describe("Edit Log in big steps", () => {
  it("opens on Details with the saved date, times and total time", async () => {
    renderEdit();
    expect(await screen.findByRole("heading", { name: "When it happened" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-10-20")).toBeInTheDocument();
    expect(screen.getByText("1 h", { selector: "[aria-live]" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Notes/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Sign/ })).not.toBeInTheDocument();
  });

  it("walks Details, Codes, Notes and saves the same fields as before", async () => {
    renderEdit();
    await screen.findByRole("heading", { name: "When it happened" });
    fireEvent.click(screen.getByRole("button", { name: "Next: Codes" }));
    expect(screen.getByRole("radio", { name: "Speech Language Therapy" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Phone/Video Conferencing" }));
    fireEvent.click(screen.getByRole("button", { name: "Next: Notes" }));
    expect(screen.getByDisplayValue(/wonderful progress/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0][0]).toBe("/api/patients/logs/41");
    expect(api.put.mock.calls[0][1]).toMatchObject({
      service_date: "2026-10-20", start_time: "19:49", end_time: "20:49", total_time: 60,
      type: "SLP", status: "1", location: "8", group_size_category: "individual",
      session_notes: "We made some wonderful progress today.",
    });
    expect(showToast).toHaveBeenCalledWith("Log updated.");
  });

  it("a note that has moved into billing can't be edited", async () => {
    api.get.mockResolvedValue({ data: [{ ...log, billing_status: "invoiced" }] });
    renderEdit();
    expect(await screen.findByText(/can no longer be edited/)).toBeInTheDocument();
  });
});

describe("changing the date needs the parent's new signature", () => {
  it("says so, renames the button, and confirms who the link went to", async () => {
    api.put.mockResolvedValue({ data: { success: true, resignRequested: true, parentEmail: "luz.parent@example.com", requestId: "r1" } });
    renderEdit();
    await screen.findByRole("heading", { name: "When it happened" });
    expect(screen.queryByText(/parent's new signature/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("2026-10-20"), { target: { value: "2026-10-22" } });
    expect(screen.getByText(/parent's new signature/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next: Codes" }));
    fireEvent.click(screen.getByRole("button", { name: "Next: Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to parent to re-sign" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0][1]).toMatchObject({ service_date: "2026-10-22" });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Sent to the parent to re-sign");
    expect(dialog).toHaveTextContent("luz.parent@example.com");
    expect(dialog).toHaveTextContent(/held from billing/);
    expect(showToast).not.toHaveBeenCalledWith("Log updated.");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await screen.findByText("child page")).toBeInTheDocument();
  });

  it("other edits keep the usual Save changes", async () => {
    renderEdit();
    await screen.findByRole("heading", { name: "When it happened" });
    fireEvent.click(screen.getByRole("button", { name: "Next: Codes" }));
    fireEvent.click(screen.getByRole("button", { name: "Next: Notes" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });
});
