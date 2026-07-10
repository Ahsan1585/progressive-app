import type { Patient } from "@/types";

// Client-side filter over the already-fetched roster — no round trip, per
// spec acceptance criterion 4 ("results updating as they type").
export const filterPatients = (patients: Patient[], query: string): Patient[] => {
  const term = query.trim().toLowerCase();
  if (!term) return patients;
  return patients.filter((p) => {
    const fullName = `${p.first_name} ${p.middle_name || ""} ${p.last_name}`.toLowerCase();
    return fullName.includes(term) || p.child_id?.toLowerCase().includes(term);
  });
};
