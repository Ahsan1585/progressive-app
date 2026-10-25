// The four steps of Log Session (Details, Codes, Notes, Sign) and what each
// one still needs before the practitioner can move on, in plain words for the
// bottom bar ("Add a start time and an end time to continue"). Same required
// fields as the single-page form had; this only splits them by step.

export const LOG_STEPS = [
  { id: "details", label: "Details", title: "When and how" },
  { id: "codes", label: "Codes", title: "Service codes" },
  { id: "notes", label: "Notes", title: "Session notes" },
  { id: "sign", label: "Sign", title: "Review and sign" },
] as const;

export interface StepContext {
  date: string;
  startTime: string;
  endTime: string;
  zeroTime: boolean;
  type: string;
  status: string;
  location: string;
  customFields: Record<string, string>;
  requiredCustom: { key: string; label: string }[];
  isIndependentPractitioner: boolean;
  companyAffiliation: string;
  isTelepractice: boolean;
  parentEmailOnFile: boolean;
  parentSig: string | null;
  practitionerSig: string | null;
}

const toMinutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

export function stepMissing(step: number, c: StepContext): string[] {
  const m: string[] = [];
  if (step === 0) {
    if (!c.date) m.push("the date");
    if (!c.zeroTime) {
      if (!c.startTime) m.push("a start time");
      if (!c.endTime) m.push("an end time");
      if (c.startTime && c.endTime && toMinutes(c.endTime) <= toMinutes(c.startTime)) m.push("an end time after the start");
    }
  } else if (step === 1) {
    if (!c.type) m.push("a service type");
    if (!c.status) m.push("a status");
    if (!c.location) m.push("a location");
    if (c.isIndependentPractitioner && !c.companyAffiliation) m.push("the agency");
    for (const f of c.requiredCustom) if (!c.customFields[f.key]) m.push(f.label.toLowerCase());
  } else if (step === 3) {
    if (c.isTelepractice) {
      if (!c.parentEmailOnFile) m.push("a parent email on file");
    } else if (!c.parentSig) {
      m.push("the parent's signature");
    }
    if (!c.practitionerSig) m.push("your signature");
  }
  return m;
}

export function firstIncompleteStep(c: StepContext): number {
  for (let i = 0; i < LOG_STEPS.length; i += 1) if (stepMissing(i, c).length) return i;
  return -1;
}

// "a, b and c"
export const joinWords = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

// The agency's phone / video location option (e.g. "Phone/Video Conferencing"),
// picked automatically when the practitioner says the session was by video.
export function videoLocationCode(options: { code: string; label: string }[]): string | null {
  const hit = options.find((o) => /video|phone|tele/i.test(o.label));
  return hit ? hit.code : null;
}
