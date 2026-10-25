import type { DraftDetails } from "@/types";

// Turns a saved draft's summary into the text on its card, so a practitioner
// can tell two drafts apart: when it was ("Sun, Oct 25 · 7:49 – 8:49 PM"),
// what it was ("Speech Language Therapy · Home"), and what is still needed
// before it can be saved.

interface Labels {
  serviceType: (code: string) => string;
  location: (code: string) => string;
}

export interface DraftDescription {
  when: string;
  what: string;
  stillNeeds: string[];
  ready: boolean;
}

const time12 = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

const dayLabel = (iso: string, today: string) => {
  if (iso === today) return "Today";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

const timeRange = (start: string, end: string) => {
  const a = time12(start), b = time12(end);
  // "7:49 – 8:49 PM" when both share AM/PM, "11:30 AM – 12:15 PM" otherwise
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
};

export function describeDraft(
  s: DraftDetails | undefined,
  labels: Labels,
  { hasSavedSignature, today }: { hasSavedSignature: boolean; today: string }
): DraftDescription {
  if (!s) return { when: "Session draft", what: "", stillNeeds: [], ready: false };

  const day = s.date ? dayLabel(s.date, today) : "No date yet";
  const when = s.zeroTime
    ? `${day} · cancelled visit`
    : s.startTime && s.endTime
      ? `${day} · ${timeRange(s.startTime, s.endTime)}`
      : `${day} · no time yet`;

  const what = s.type
    ? [labels.serviceType(s.type), s.location ? labels.location(s.location) : null].filter(Boolean).join(" · ")
    : "No service chosen yet";

  const stillNeeds: string[] = [];
  if (!s.date || (!s.zeroTime && (!s.startTime || !s.endTime))) stillNeeds.push("start and end time");
  if (!s.type || !s.status || !s.location) stillNeeds.push("service codes");
  if (!s.hasParentSignature) stillNeeds.push("parent signature");
  // the saved signature is applied automatically on the Sign step
  if (!s.hasPractitionerSignature && !hasSavedSignature) stillNeeds.push("your signature");

  return { when, what, stillNeeds, ready: stillNeeds.length === 0 };
}
