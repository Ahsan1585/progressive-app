// While a practitioner is entering a session note, the bottom tabs are hidden:
// one stray tap used to leave the screen and lose everything typed so far.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/contexts/AppDataContext", () => ({
  useAppData: () => ({ rejectedLogs: [], telepracticeRequests: [], unreadMessageCount: 0, notifications: [] }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isIndependentPractitioner: false }) }));

import { ShellLayout } from "../ShellLayout";

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ShellLayout />}>
          <Route path="*" element={<div>screen</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

describe("ShellLayout tab bar", () => {
  it.each(["/home", "/roster", "/patients/p1", "/profile/signature"])("shows the tabs on %s", (path) => {
    at(path);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it.each(["/patients/p1/log", "/patients/p1/logs/77/edit", "/inbox/55/resubmit"])("hides the tabs while entering a session note (%s)", (path) => {
    at(path);
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });
});
