import { describe, it, expect } from "vitest";
import { stepMissing, firstIncompleteStep, LOG_STEPS, videoLocationCode, type StepContext } from "../logSessionSteps";

const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  date: "2026-10-25", startTime: "09:00", endTime: "09:45", zeroTime: false,
  type: "DI", status: "1", location: "1", customFields: {}, requiredCustom: [],
  isIndependentPractitioner: false, companyAffiliation: "",
  isTelepractice: false, parentEmailOnFile: true, parentSig: "data:x", practitionerSig: "data:y",
  ...over,
});

describe("log session steps", () => {
  it("has four steps in order", () => {
    expect(LOG_STEPS.map((s) => s.label)).toEqual(["Details", "Codes", "Notes", "Sign"]);
  });

  it("Details needs a date and both times, unless the session was cancelled", () => {
    expect(stepMissing(0, ctx({ startTime: "", endTime: "" }))).toEqual(["a start time", "an end time"]);
    expect(stepMissing(0, ctx({ date: "" }))).toEqual(["the date"]);
    expect(stepMissing(0, ctx({ startTime: "", endTime: "", zeroTime: true }))).toEqual([]);
  });

  it("Details flags an end time that is not after the start", () => {
    expect(stepMissing(0, ctx({ startTime: "10:00", endTime: "09:30" }))).toEqual(["an end time after the start"]);
  });

  it("Codes needs service type, status and location, plus the agency for independents and required custom fields", () => {
    expect(stepMissing(1, ctx({ type: "", status: "", location: "" }))).toEqual(["a service type", "a status", "a location"]);
    expect(stepMissing(1, ctx({ isIndependentPractitioner: true }))).toEqual(["the agency"]);
    expect(stepMissing(1, ctx({ requiredCustom: [{ key: "auth", label: "Authorization #" }] }))).toEqual(["authorization #"]);
    expect(stepMissing(1, ctx({ requiredCustom: [{ key: "auth", label: "Authorization #" }], customFields: { auth: "A1" } }))).toEqual([]);
  });

  it("Notes is optional", () => {
    expect(stepMissing(2, ctx())).toEqual([]);
  });

  it("Sign needs the parent's signature in person, a parent email for telepractice, and always the practitioner's", () => {
    expect(stepMissing(3, ctx({ parentSig: null }))).toEqual(["the parent's signature"]);
    expect(stepMissing(3, ctx({ parentSig: null, isTelepractice: true }))).toEqual([]);
    expect(stepMissing(3, ctx({ isTelepractice: true, parentEmailOnFile: false }))).toEqual(["a parent email on file"]);
    expect(stepMissing(3, ctx({ practitionerSig: null }))).toEqual(["your signature"]);
  });

  it("firstIncompleteStep points at the earliest step still missing something", () => {
    expect(firstIncompleteStep(ctx())).toBe(-1);
    expect(firstIncompleteStep(ctx({ practitionerSig: null, location: "" }))).toBe(1);
    expect(firstIncompleteStep(ctx({ practitionerSig: null }))).toBe(3);
  });
});

describe("videoLocationCode", () => {
  it("finds the agency's phone / video location option", () => {
    const opts = [{ code: "1", label: "Home" }, { code: "3", label: "Service Provider Clinic/Office" }, { code: "8", label: "Phone/Video Conferencing" }];
    expect(videoLocationCode(opts)).toBe("8");
  });
  it("matches telehealth-style labels and returns null when there is none", () => {
    expect(videoLocationCode([{ code: "T", label: "Telehealth" }])).toBe("T");
    expect(videoLocationCode([{ code: "1", label: "Home" }])).toBeNull();
  });
});
