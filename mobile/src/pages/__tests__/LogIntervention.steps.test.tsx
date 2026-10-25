// The step-by-step Log Session flow end to end: Next is blocked until a step is
// complete (and says what's missing), codes arrive from the child's last
// session, the saved signature is applied on the Sign step, and saving sends
// the same payload the single-page form did.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock("@/api/axiosInstance", () => ({ default: api }));

const opt = (code: string, label: string) => ({ id: Number(code) || 1, category: "x", code, label, sort_order: 0, is_active: true });
const appData = {
  patients: [{ id: "p1", first_name: "leo", middle_name: null, last_name: "rivera", dob: "2024-01-01", county: "Monmouth", parent_email: "leo.parent@example.com" }],
  profile: { first_name: "Maya", last_name: "Chen", position_title: "DI", signature: "data:image/png;base64,SAVED", service_types: ["DI", "FT"] },
  setSavedSignature: vi.fn(),
  serviceTypeOptions: [opt("DI", "Developmental Intervention"), opt("FT", "Family Training"), opt("SLP", "Speech Language Therapy")],
  statusOptions: [opt("1", "Direct Child Service"), opt("3", "Family Cancelled")],
  locationOptions: [opt("1", "Home"), opt("3", "Service Provider Clinic/Office"), opt("8", "Phone/Video Conferencing")],
  groupSizeOptions: [opt("individual", "Direct Child Service - Individual"), opt("consultation", "Consultation/Facilitation with Others")],
  dropdownOptions: {}, dropdownCategories: [], agencies: [], fetchAgencies: vi.fn(),
};
vi.mock("@/contexts/AppDataContext", () => ({ useAppData: () => appData }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ practitioner: { id: 7, firstName: "Maya", lastName: "Chen" }, isIndependentPractitioner: false }) }));
const showToast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast }) }));

import LogIntervention from "../LogIntervention";

const renderScreen = () =>
  render(
    <MemoryRouter initialEntries={["/patients/p1/log"]}>
      <Routes>
        <Route path="/patients/:id/log" element={<LogIntervention />} />
        <Route path="/patients/:id" element={<div>child page</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  api.get.mockReset(); api.post.mockReset(); showToast.mockReset();
  api.get.mockImplementation((url: string) =>
    url.endsWith("/last-session-defaults")
      ? Promise.resolve({ data: { success: true, defaults: { status: "1", type: "DI", location: "1", groupSizeCategory: "individual", companyAffiliation: null } } })
      : Promise.resolve({ data: { success: true } })
  );
  api.post.mockResolvedValue({ data: { success: true } });
});

describe("Log Session in four steps", () => {
  it("opens on Details with the child's name and blocks Next until the times are in", () => {
    renderScreen();
    expect(screen.getByText("leo rivera")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "When and how" })).toBeInTheDocument();
    expect(screen.getByText("Add a start time and an end time to continue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next: Codes" }));
    expect(screen.getByRole("heading", { name: "When and how" })).toBeInTheDocument(); // still on step 1
    expect(screen.getByText("Add both the start and end time.")).toBeInTheDocument();
  });

  it("walks Details, Codes (filled from the last session), Notes, Sign, then saves the telepractice session", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("radio", { name: /Video \(telepractice\)/ }));
    const [start, end] = screen.getAllByDisplayValue("").filter((el) => (el as HTMLInputElement).type === "time");
    fireEvent.change(start, { target: { value: "09:00" } });
    fireEvent.change(end, { target: { value: "09:45" } });
    expect(screen.getByText("45 min", { selector: "[aria-live]" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next: Codes" }));

    expect(screen.getByRole("heading", { name: "Service codes" })).toBeInTheDocument();
    await screen.findByText(/Filled in from leo's last session/);
    expect(screen.getByRole("radio", { name: /Developmental Intervention/ })).toHaveAttribute("aria-checked", "true");
    // only the practitioner's own service types are offered
    expect(screen.queryByRole("radio", { name: /Speech Language Therapy/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next: Notes" }));

    fireEvent.change(screen.getByLabelText(/What happened in the session/), { target: { value: "Stacked blocks." } });
    fireEvent.click(screen.getByRole("button", { name: "Next: Sign" }));

    expect(screen.getByRole("heading", { name: "Review and sign" })).toBeInTheDocument();
    expect(screen.getByText(/leo\.parent@example\.com/)).toBeInTheDocument();
    await screen.findByText("Everything is ready to save"); // saved signature applied automatically
    fireEvent.click(screen.getByRole("button", { name: "Send to Parent to Sign" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe("/api/telepractice-signatures");
    expect(payload).toMatchObject({
      patientId: "p1", startTime: "09:00", endTime: "09:45", totalTime: 45,
      type: "DI", status: "1", location: "8", groupSizeCategory: "individual", // video session -> Phone/Video location
      note: "Stacked blocks.", practitionerSignatureBase64: "data:image/png;base64,SAVED",
    });
  });

  it("Edit on the review jumps back to that step", async () => {
    renderScreen();
    const [start, end] = screen.getAllByDisplayValue("").filter((el) => (el as HTMLInputElement).type === "time");
    fireEvent.change(start, { target: { value: "10:00" } });
    fireEvent.change(end, { target: { value: "10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: Codes" }));
    await screen.findByText(/Filled in from/);
    fireEvent.click(screen.getByRole("button", { name: "Next: Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Next: Sign" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[2]); // Service
    expect(screen.getByRole("heading", { name: "Service codes" })).toBeInTheDocument();
    // the in-person session still needs the parent's signature before saving
    fireEvent.click(screen.getByRole("tab", { name: /Sign/ }));
    expect(screen.getByText("Add the parent's signature to continue")).toBeInTheDocument();
  });

  it("choosing Video selects the Phone / Video location over last session's location; In person puts it back", async () => {
    renderScreen();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("radio", { name: /Video \(telepractice\)/ }));
    const [start, end] = screen.getAllByDisplayValue("").filter((el) => (el as HTMLInputElement).type === "time");
    fireEvent.change(start, { target: { value: "09:00" } });
    fireEvent.change(end, { target: { value: "09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: Codes" }));
    await screen.findByText(/Filled in from/);
    expect(screen.getByRole("radio", { name: /Phone\/Video Conferencing/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /^Home/ })).toHaveAttribute("aria-checked", "false");
    // service and status still come from the last session
    expect(screen.getByRole("radio", { name: /Developmental Intervention/ })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("tab", { name: /Details/ }));
    fireEvent.click(screen.getByRole("radio", { name: /In person/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Codes/ }));
    expect(screen.getByRole("radio", { name: /^Home/ })).toHaveAttribute("aria-checked", "true");
  });
});
