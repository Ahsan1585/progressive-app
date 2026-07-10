import { describe, it, expect } from "vitest";
import { filterPatients } from "./roster";
import type { Patient } from "@/types";

const patients: Patient[] = [
  { id: "1", first_name: "Ada", middle_name: null, last_name: "Lovelace", dob: "2020-01-01", county: "Bergen", child_id: "123456789", practitioner_id: "p1" },
  { id: "2", first_name: "Grace", middle_name: "B", last_name: "Hopper", dob: "2019-05-05", county: "Essex", child_id: "987654321", practitioner_id: "p1" },
];

describe("filterPatients", () => {
  it("returns every patient when the query is empty", () => {
    expect(filterPatients(patients, "")).toHaveLength(2);
  });

  it("matches on first name case-insensitively", () => {
    expect(filterPatients(patients, "ada")).toEqual([patients[0]]);
  });

  it("matches on last name", () => {
    expect(filterPatients(patients, "hopper")).toEqual([patients[1]]);
  });

  it("matches on middle name", () => {
    expect(filterPatients(patients, " b ")).toEqual([patients[1]]);
  });

  it("matches on child id", () => {
    expect(filterPatients(patients, "987654321")).toEqual([patients[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterPatients(patients, "zzz")).toEqual([]);
  });
});
