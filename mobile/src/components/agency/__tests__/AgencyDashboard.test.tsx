import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AgencyDashboard } from "../AgencyDashboard";
import type { AgencySummary } from "@/types";

const summary = (over: Partial<AgencySummary> = {}): AgencySummary => ({
  month: "2026-10",
  hasPayRate: true,
  tiles: { submitted: { count: 34, value: 1921, hours: 28.25 }, invoiced: { count: 14, value: 799 }, paid: { count: 6, value: 323 } },
  breakdown: {
    awaiting: { count: 7, value: 459 }, approved: { count: 9, value: 408 }, invoiced: { count: 8, value: 476 }, paid: { count: 6, value: 323 },
    returned: { count: 2, value: 119 }, onHold: { count: 1, value: 68 }, declined: { count: 1, value: 68 },
  },
  owed: { value: 1530, inProgress: 867, invoicedUnpaid: 595, onHold: 68 },
  waitingOnFix: { count: 3, value: 187 },
  needsYou: { returned: [], onHold: [] },
  declined: [{ id: 9, childName: "Ava Thompson", serviceDate: "2026-10-09", reason: "Duplicate of an earlier entry.", since: null, daysAgo: null, overdue: false, value: 68, minutes: 60 }],
  monthNotes: [
    { id: 1, stage: "paid", childName: "Leo Rivera", serviceDate: "2026-10-02", value: 68, minutes: 60 },
    { id: 2, stage: "awaiting", childName: "Noah Kim", serviceDate: "2026-10-03", value: 51, minutes: 45 },
  ],
  trend: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((label, i) => ({ month: `2026-0${5 + i}`.replace("2026-010", "2026-10"), label, submittedValue: 2000 + i * 100, paidValue: 1900 + i * 50, hours: 30 + i })),
  ...over,
});

const base = { loading: false, error: null as string | null, onRetry: vi.fn(), onMonthChange: vi.fn(), canGoNext: false };

describe("AgencyDashboard", () => {
  it("shows the month's Submitted, Invoiced and Paid with counts", () => {
    render(<AgencyDashboard {...base} summary={summary()} />);
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    const tiles = screen.getByRole("group", { name: "This month" });
    expect(within(tiles).getByText("$1.9k")).toBeInTheDocument();
    expect(within(tiles).getByText("34 notes · 28.3h")).toBeInTheDocument();
    expect(within(tiles).getByText("$799")).toBeInTheDocument();
    expect(within(tiles).getByText("$323")).toBeInTheDocument();
  });

  it("lists where the month's money is, ending in a total equal to Submitted", () => {
    render(<AgencyDashboard {...base} summary={summary()} />);
    const list = screen.getByRole("list", { name: "Where this month's notes are" });
    expect(within(list).getByText("In progress")).toBeInTheDocument();
    expect(within(list).getByText("$867")).toBeInTheDocument(); // 459 + 408
    expect(within(list).getByText("Waiting on your fix")).toBeInTheDocument();
    expect(within(list).getByText("Submitted in October")).toBeInTheDocument();
    expect(within(list).getByText("$1,921")).toBeInTheDocument();
  });

  it("shows what is owed across all months, with returned money called out separately", () => {
    render(<AgencyDashboard {...base} summary={summary()} />);
    expect(screen.getByText("$1,530")).toBeInTheDocument();
    expect(screen.getByText("+ $187 more once your returned notes are fixed")).toBeInTheDocument();
  });

  it("tapping a progress stage lists that stage's notes", () => {
    render(<AgencyDashboard {...base} summary={summary()} />);
    expect(screen.queryByText(/Leo Rivera/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Paid, 6 notes/ }));
    expect(screen.getByText(/Leo Rivera/)).toBeInTheDocument();
  });

  it("keeps declined notes in one collapsed line with the office's reason", () => {
    render(<AgencyDashboard {...base} summary={summary()} />);
    expect(screen.getByText(/Not billable in October/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicate of an earlier entry\./, { exact: false })).not.toBeVisible();
  });

  it("month arrows: previous asks for the month before; next is off for the current month", () => {
    const onMonthChange = vi.fn();
    render(<AgencyDashboard {...base} onMonthChange={onMonthChange} summary={summary()} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(onMonthChange).toHaveBeenCalledWith(-1);
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  });

  it("without a pay rate on file, says so instead of showing $0 as if it were real", () => {
    render(<AgencyDashboard {...base} summary={summary({ hasPayRate: false })} />);
    expect(screen.getByText(/pay rate isn't set up yet/i)).toBeInTheDocument();
  });

  it("loading shows placeholders; an error offers a retry", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<AgencyDashboard {...base} loading summary={null} />);
    expect(screen.getByLabelText("Loading your dashboard")).toBeInTheDocument();
    rerender(<AgencyDashboard {...base} error="Failed to load your dashboard." onRetry={onRetry} summary={null} />);
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
