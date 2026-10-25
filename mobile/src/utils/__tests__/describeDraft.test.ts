import { describe, it, expect } from "vitest";
import { describeDraft } from "../describeDraft";
import type { DraftDetails } from "@/types";

const labels = {
  serviceType: (c: string) => ({ SLP: "Speech Language Therapy", DI: "Developmental Intervention" }[c] || c),
  location: (c: string) => ({ "1": "Home", "8": "Phone/Video Conferencing" }[c] || c),
};
const d = (over: Partial<DraftDetails> = {}): DraftDetails => ({
  date: "2026-10-25", startTime: "19:49", endTime: "20:49", zeroTime: false,
  type: "SLP", status: "1", location: "1", hasNote: true,
  hasParentSignature: false, hasPractitionerSignature: false, ...over,
});

describe("describeDraft", () => {
  it("names the session by date, time, service and location, and says what is still needed", () => {
    const r = describeDraft(d(), labels, { hasSavedSignature: true, today: "2026-10-26" });
    expect(r.when).toBe("Sun, Oct 25 · 7:49 – 8:49 PM");
    expect(r.what).toBe("Speech Language Therapy · Home");
    expect(r.stillNeeds).toEqual(["parent signature"]); // their saved signature is applied automatically
    expect(r.ready).toBe(false);
  });

  it("says Today for today's date and flags missing times and codes", () => {
    const r = describeDraft(d({ date: "2026-10-26", startTime: null, endTime: null, type: null, location: null }), labels, { hasSavedSignature: false, today: "2026-10-26" });
    expect(r.when).toBe("Today · no time yet");
    expect(r.what).toBe("No service chosen yet");
    expect(r.stillNeeds).toEqual(["start and end time", "service codes", "parent signature", "your signature"]);
  });

  it("a cancelled visit needs no times", () => {
    const r = describeDraft(d({ zeroTime: true, startTime: null, endTime: null, hasParentSignature: true }), labels, { hasSavedSignature: true, today: "2026-10-26" });
    expect(r.when).toBe("Sun, Oct 25 · cancelled visit");
    expect(r.stillNeeds).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it("copes with no summary at all (older app data)", () => {
    const r = describeDraft(undefined, labels, { hasSavedSignature: true, today: "2026-10-26" });
    expect(r.when).toBe("Session draft");
    expect(r.what).toBe("");
    expect(r.stillNeeds).toEqual([]);
    expect(r.ready).toBe(false);
  });
});
