import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NeedsYouCard } from "../NeedsYouCard";
import type { AgencyNoteItem } from "@/types";

const item = (over: Partial<AgencyNoteItem> = {}): AgencyNoteItem => ({
  id: 1, childName: "Leo Rivera", serviceDate: "2026-09-28", reason: "Parent signature is missing.",
  since: "2026-10-02", daysAgo: 22, overdue: true, value: 68, minutes: 60, ...over,
});
const returned = [item(), item({ id: 2, childName: "Zoe Patel", serviceDate: "2026-10-13", reason: "Location does not match EIMS.", daysAgo: 3, overdue: false, value: 51 })];
const onHold = [item({ id: 3, childName: "Mia Santos", reason: "Waiting on the IFSP team.", daysAgo: 4, overdue: false, value: 68 })];

describe("NeedsYouCard", () => {
  it("starts collapsed: says how many notes and how much money, hides the rows", () => {
    render(<NeedsYouCard returned={returned} onHold={onHold} waitingOnFix={{ count: 2, value: 119 }} onFix={vi.fn()} />);
    expect(screen.getByText("Fix 2 returned notes")).toBeInTheDocument();
    expect(screen.getByText(/\$119 won't be paid until you fix them\. Also 1 on hold\./)).toBeInTheDocument();
    expect(screen.queryByText("Parent signature is missing.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fix 2 returned notes/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("tapping the header shows each returned note with its reason, age and a Fix it button", () => {
    const onFix = vi.fn();
    render(<NeedsYouCard returned={returned} onHold={onHold} waitingOnFix={{ count: 2, value: 119 }} onFix={onFix} />);
    fireEvent.click(screen.getByRole("button", { name: /Fix 2 returned notes/ }));
    expect(screen.getByText("Parent signature is missing.")).toBeInTheDocument();
    expect(screen.getByText("Returned 22 days ago")).toBeInTheDocument();
    expect(screen.getByText("Office: Waiting on the IFSP team.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Fix it/ })[0]);
    expect(onFix).toHaveBeenCalledWith(1);
  });

  it("with only notes on hold, says there is nothing for the practitioner to do", () => {
    render(<NeedsYouCard returned={[]} onHold={onHold} waitingOnFix={{ count: 0, value: 0 }} onFix={vi.fn()} />);
    expect(screen.getByText("1 note on hold by the office")).toBeInTheDocument();
    expect(screen.getByText(/\$68 paused\. Nothing for you to do\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fix it/ })).not.toBeInTheDocument();
  });

  it("with nothing open, shows the all-clear line", () => {
    render(<NeedsYouCard returned={[]} onHold={[]} waitingOnFix={{ count: 0, value: 0 }} onFix={vi.fn()} />);
    expect(screen.getByText("Nothing needs you. All your notes are moving.")).toBeInTheDocument();
  });
});
