import * as React from "react";
import { CalendarPlus, ChevronDown, Mail, TriangleAlert } from "lucide-react";
import api from "@/api/axiosInstance";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { addMinutesToTime } from "@/utils/time";
import { cn } from "@/lib/utils";
import type { ScheduledSession, ApiErrorBody } from "@/types";

interface ScheduleSessionSheetProps {
  /** Non-null opens the sheet. Pass an existing session to reschedule it, or `"new"` to create one. */
  target: ScheduledSession | "new" | null;
  patientId: string;
  parentEmail?: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

// Scheduling in a few big taps: a day, a start time, a length. The end time is
// worked out from the length (Custom still allows any end time). Location is a
// quick choice or free text, notes are tucked away. The request sent to the
// server is unchanged: { sessionDate, startTime, endTime, location, notes }.

const DAYS_AHEAD = 14;
const LENGTHS = [30, 45, 60, 90];
const DEFAULT_LENGTH = 60;
const LOCATIONS = ["Home", "Daycare or community", "Clinic", "Video"];
const TIME_GROUPS: { label: string; from: number; to: number }[] = [
  { label: "Morning", from: 7 * 60, to: 11 * 60 + 30 },
  { label: "Afternoon", from: 12 * 60, to: 16 * 60 + 30 },
  { label: "Evening", from: 17 * 60, to: 19 * 60 + 30 },
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const toMins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const time12 = (t: string) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`; };
const range12 = (a: string, b: string) => {
  const x = time12(a), y = time12(b);
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}`;
};
const longDay = (iso: string) => fromIso(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const chipBase = "press-scale shrink-0 rounded-[14px] border-2 font-bold text-ink";
const chipOff = "border-border-strong bg-surface";
const chipOn = "border-primary bg-primary text-primary-fg";

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <p className="flex items-baseline justify-between text-[17px] font-extrabold text-ink">
      {children}
      {hint && <span className="text-sm font-semibold text-ink-muted">{hint}</span>}
    </p>
  );
}

export function ScheduleSessionSheet({ target, patientId, parentEmail, onOpenChange, onSaved }: ScheduleSessionSheetProps) {
  const { showToast } = useToast();
  const isReschedule = !!target && target !== "new";

  const today = isoOf(new Date());
  const [date, setDate] = React.useState("");
  const [start, setStart] = React.useState("");
  const [length, setLength] = React.useState<number | "custom">(DEFAULT_LENGTH);
  const [customEnd, setCustomEnd] = React.useState("");
  const [otherTime, setOtherTime] = React.useState(false);
  const [location, setLocation] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    if (target && target !== "new") {
      const s = target.start_time.slice(0, 5), e = target.end_time.slice(0, 5);
      const mins = toMins(e) - toMins(s);
      setDate(target.session_date.split("T")[0]);
      setStart(s);
      if (LENGTHS.includes(mins)) { setLength(mins); setCustomEnd(""); } else { setLength("custom"); setCustomEnd(e); }
      setOtherTime(!TIME_GROUPS.some((g) => toMins(s) >= g.from && toMins(s) <= g.to && toMins(s) % 30 === 0));
      setLocation(target.location || "");
      setNotes(target.notes || "");
      setNotesOpen(!!target.notes);
    } else if (target === "new") {
      setDate(""); setStart(""); setLength(DEFAULT_LENGTH); setCustomEnd(""); setOtherTime(false);
      setLocation(""); setNotes(""); setNotesOpen(false);
    }
  }, [target]);

  const days = React.useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < DAYS_AHEAD; i += 1) { const d = new Date(); d.setDate(d.getDate() + i); out.push(isoOf(d)); }
    if (date && !out.includes(date) && date >= today) out.push(date); // a date picked further out
    return out;
  }, [date, today]);

  const end = length === "custom" ? customEnd : start ? addMinutesToTime(start, length) : "";
  const ready = !!date && !!start && !!end && toMins(end) > toMins(start);
  const dayLabel = date === today ? "Today" : date ? longDay(date) : "";
  const buttonLabel = !date || !start
    ? "Pick a day and a start time"
    : !end || toMins(end) <= toMins(start)
      ? "Pick an end time after the start"
      : `${isReschedule ? "Save" : "Schedule"} · ${dayLabel} · ${range12(start, end)}`;

  const handleSubmit = async () => {
    if (!ready) return;
    if (date < today) { setError("Session date can't be in the past."); return; }
    setSubmitting(true);
    setError(null);
    const body = { sessionDate: date, startTime: start, endTime: end, location: location.trim(), notes: notes.trim() };
    try {
      if (target && target !== "new") {
        await api.patch(`/api/schedule/${target.id}`, body);
        showToast("Session rescheduled.");
      } else {
        await api.post("/api/schedule", { patientId, ...body });
        showToast("Session scheduled.");
      }
      onSaved();
    } catch (err) {
      const b = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(b?.error || "Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent aria-labelledby="schedule-title">
        {target && (
          <>
            <SheetHeader>
              <SheetTitle id="schedule-title" className="text-[24px] font-extrabold tracking-tight">{isReschedule ? "Reschedule session" : "Schedule a session"}</SheetTitle>
              <SheetDescription asChild>
                {parentEmail ? (
                  <p className="flex items-center gap-2 rounded-[12px] bg-primary-tint px-3 py-2 text-[14px] font-semibold text-ink-body">
                    <Mail className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">We&apos;ll email a calendar invite to <b className="text-ink">{parentEmail}</b></span>
                  </p>
                ) : (
                  <p className="flex items-center gap-2 rounded-[12px] bg-warning-bg px-3 py-2 text-[14px] font-semibold text-warning">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                    No parent email on file, so no calendar invite will be sent.
                  </p>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="-mx-1 mb-3 max-h-[58vh] space-y-6 overflow-y-auto px-1 pb-2">
              {/* day */}
              <div className="space-y-2.5">
                <Label>Day</Label>
                <div role="radiogroup" aria-label="Day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                  {days.map((iso, i) => {
                    const d = fromIso(iso);
                    const top = i === 0 && iso === today ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" });
                    const on = iso === date;
                    return (
                      <button key={iso} type="button" role="radio" aria-checked={on} aria-label={`${top}, ${longDay(iso)}`}
                        onClick={() => setDate(iso)}
                        className={cn(chipBase, "flex w-[84px] flex-col items-center py-2.5", on ? chipOn : chipOff)}>
                        <span className={cn("text-[13px] font-bold", on ? "text-primary-fg" : "text-ink-muted")}>{top}</span>
                        <span className="text-[22px] font-extrabold leading-tight">{d.getDate()}</span>
                        <span className={cn("text-[12px] font-semibold", on ? "text-primary-fg" : "text-ink-muted")}>{d.toLocaleDateString("en-US", { month: "short" })}</span>
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-2 text-[14px] font-bold text-primary">
                  <CalendarPlus className="size-4" aria-hidden="true" />
                  Another date
                  <Input type="date" min={today} value={date && !days.slice(0, DAYS_AHEAD).includes(date) ? date : ""} onChange={(e) => e.target.value && setDate(e.target.value)}
                    className="h-10 max-w-[170px] rounded-[10px] border-2 text-[15px]" aria-label="Pick another date" />
                </label>
              </div>

              {/* start time */}
              <div className="space-y-2.5">
                <Label>Start time</Label>
                {!otherTime && TIME_GROUPS.map((g) => (
                  <div key={g.label} className="space-y-1.5">
                    <p className="text-[12.5px] font-bold uppercase tracking-wide text-ink-muted">{g.label}</p>
                    <div role="radiogroup" aria-label={`${g.label} times`} className="grid grid-cols-4 gap-2">
                      {Array.from({ length: (g.to - g.from) / 30 + 1 }, (_, k) => hhmm(g.from + k * 30)).map((t) => (
                        <button key={t} type="button" role="radio" aria-checked={t === start} aria-label={time12(t)}
                          onClick={() => setStart(t)}
                          className={cn(chipBase, "min-h-[46px] px-1 text-[14.5px]", t === start ? chipOn : chipOff)}>
                          {time12(t).replace(" AM", "").replace(" PM", "")}
                          <span className="ml-0.5 text-[11px] font-semibold opacity-75">{time12(t).slice(-2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {otherTime ? (
                  <div className="flex items-center gap-3">
                    <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-[56px] max-w-[180px] rounded-[14px] border-2 text-[19px] font-bold" aria-label="Start time" />
                    <button type="button" className="text-[14px] font-bold text-primary" onClick={() => setOtherTime(false)}>Show quick times</button>
                  </div>
                ) : (
                  <button type="button" className="text-[14px] font-bold text-primary" onClick={() => setOtherTime(true)}>Other time</button>
                )}
              </div>

              {/* length */}
              <div className="space-y-2.5">
                <Label hint={start && end && toMins(end) > toMins(start) ? `Ends ${time12(end)}` : undefined}>Length</Label>
                <div role="radiogroup" aria-label="Length" className="grid grid-cols-5 gap-2">
                  {LENGTHS.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={length === m} aria-label={`${m} min`}
                      onClick={() => setLength(m)}
                      className={cn(chipBase, "min-h-[50px] text-[15px]", length === m ? chipOn : chipOff)}>
                      {m}<span className="ml-0.5 text-[11px] font-semibold opacity-75">min</span>
                    </button>
                  ))}
                  <button type="button" role="radio" aria-checked={length === "custom"} aria-label="Custom end time"
                    onClick={() => { setLength("custom"); if (!customEnd && start) setCustomEnd(addMinutesToTime(start, DEFAULT_LENGTH)); }}
                    className={cn(chipBase, "min-h-[50px] text-[14px]", length === "custom" ? chipOn : chipOff)}>
                    Custom
                  </button>
                </div>
                {length === "custom" && (
                  <label className="flex items-center gap-3 text-[15px] font-bold text-ink-muted">
                    Ends at
                    <Input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-[56px] max-w-[180px] rounded-[14px] border-2 text-[19px] font-bold" aria-label="End time" />
                  </label>
                )}
              </div>

              {/* location */}
              <div className="space-y-2.5">
                <Label hint="Optional">Location</Label>
                <div role="radiogroup" aria-label="Location" className="flex flex-wrap gap-2">
                  {LOCATIONS.map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={location === l} aria-label={l}
                      onClick={() => setLocation(location === l ? "" : l)}
                      className={cn(chipBase, "min-h-[46px] px-3.5 text-[15px]", location === l ? chipOn : chipOff)}>
                      {l}
                    </button>
                  ))}
                </div>
                <Input value={LOCATIONS.includes(location) ? "" : location} onChange={(e) => setLocation(e.target.value)}
                  placeholder="Or type a location" aria-label="Type a location" className="h-[52px] rounded-[14px] border-2 text-[16px]" />
              </div>

              {/* notes */}
              {notesOpen ? (
                <div className="space-y-2.5">
                  <Label hint="Optional">Note for this session</Label>
                  <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-[14px] border-2 text-[16px]" aria-label="Note for this session" />
                </div>
              ) : (
                <button type="button" onClick={() => setNotesOpen(true)} className="flex items-center gap-1.5 text-[15px] font-bold text-primary">
                  <ChevronDown className="size-4" aria-hidden="true" /> Add a note
                </button>
              )}

              {error && <p role="alert" className="text-[15px] font-semibold text-danger">{error}</p>}
            </div>

            <Button className="h-[60px] w-full rounded-[18px] text-[17px] font-extrabold" onClick={handleSubmit} loading={submitting} disabled={!ready || submitting}>
              {buttonLabel}
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
