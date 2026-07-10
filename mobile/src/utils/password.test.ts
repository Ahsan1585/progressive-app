import { describe, it, expect } from "vitest";
import { isPasswordStrong, getPasswordRules } from "./password";

describe("isPasswordStrong", () => {
  it("rejects a password missing an uppercase letter", () => {
    expect(isPasswordStrong("lowercase1!")).toBe(false);
  });

  it("rejects a password missing a special character", () => {
    expect(isPasswordStrong("Abcdefg1")).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(isPasswordStrong("Ab1!")).toBe(false);
  });

  it("accepts a password meeting every rule", () => {
    expect(isPasswordStrong("Abcdefg1!")).toBe(true);
  });
});

describe("getPasswordRules", () => {
  it("flags each unmet rule independently", () => {
    const rules = getPasswordRules("abcdefgh");
    const byId = Object.fromEntries(rules.map((r) => [r.id, r.met]));
    expect(byId.length).toBe(true);
    expect(byId.lowercase).toBe(true);
    expect(byId.uppercase).toBe(false);
    expect(byId.digit).toBe(false);
    expect(byId.special).toBe(false);
  });

  it("marks every rule met for a fully compliant password", () => {
    const rules = getPasswordRules("Abcdefg1!");
    expect(rules.every((r) => r.met)).toBe(true);
  });
});
