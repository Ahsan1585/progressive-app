import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/contexts/AppDataContext", () => ({
  useAppData: () => ({
    serviceTypeOptions: [{ code: "SLP", label: "Speech Language Therapy" }],
    locationOptions: [{ code: "1", label: "Home" }],
    profile: { signature: "data:image/png;base64,SAVED" },
  }),
}));

import { DraftCard } from "../DraftCard";

const summary = {
  date: "2026-09-14", startTime: "19:49", endTime: "20:49", zeroTime: false,
  type: "SLP", status: "1", location: "1", hasNote: true,
  hasParentSignature: false, hasPractitionerSignature: false,
};

describe("DraftCard", () => {
  it("shows when and what the draft is, and what it still needs", () => {
    render(<DraftCard summary={summary} updatedAt={new Date().toISOString()} onResume={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/Sep 14 · 7:49 – 8:49 PM/)).toBeInTheDocument(); // a past date, never "Today"
    expect(screen.getByText("Speech Language Therapy · Home")).toBeInTheDocument();
    expect(screen.getByText(/Still needs parent signature/)).toBeInTheDocument();
  });

  it("can show the child's name (Home's list) and resumes or discards", () => {
    const onResume = vi.fn(), onDiscard = vi.fn();
    render(<DraftCard childName="luz quintero" summary={{ ...summary, hasParentSignature: true }} updatedAt={new Date().toISOString()} onResume={onResume} onDiscard={onDiscard} />);
    expect(screen.getByText("luz quintero")).toBeInTheDocument();
    expect(screen.getByText(/Ready to save/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Resume draft/ }));
    expect(onResume).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(onDiscard).toHaveBeenCalled();
  });
});
