import { describe, it, expect } from "vitest";
import { calculateTotalMinutes, formatTime12h, formatSafeDate } from "./time";

describe("calculateTotalMinutes", () => {
  it("returns 0 when either time is missing", () => {
    expect(calculateTotalMinutes("", "10:00")).toBe(0);
    expect(calculateTotalMinutes("10:00", "")).toBe(0);
  });

  it("computes the difference in minutes for a same-day span", () => {
    expect(calculateTotalMinutes("09:00", "10:30")).toBe(90);
  });

  it("wraps past midnight when end is earlier than start", () => {
    expect(calculateTotalMinutes("23:30", "00:15")).toBe(45);
  });

  it("returns 0 for an identical start and end time", () => {
    expect(calculateTotalMinutes("09:00", "09:00")).toBe(0);
  });
});

describe("formatTime12h", () => {
  it("returns an empty string for a falsy input", () => {
    expect(formatTime12h("")).toBe("");
  });

  it("formats midnight as 12:00 AM", () => {
    expect(formatTime12h("00:00")).toBe("12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    expect(formatTime12h("12:00")).toBe("12:00 PM");
  });

  it("formats a standard afternoon time", () => {
    expect(formatTime12h("14:05")).toBe("2:05 PM");
  });
});

describe("formatSafeDate", () => {
  it("returns N/A for a falsy input", () => {
    expect(formatSafeDate(undefined)).toBe("N/A");
  });

  it("does not shift the date across timezones", () => {
    expect(formatSafeDate("2026-01-05")).toBe("1/5/2026");
    expect(formatSafeDate("2026-01-05T00:00:00.000Z")).toBe("1/5/2026");
  });
});
