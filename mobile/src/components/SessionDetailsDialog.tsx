import { CalendarCheck, CalendarX, Clock, MapPin, StickyNote } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ScheduledSession } from "@/types";

interface SessionDetailsDialogProps {
  /** Non-null opens the popup. */
  session: ScheduledSession | null;
  onOpenChange: (open: boolean) => void;
  onOpenChild: () => void;
  onLogSession: () => void;
}

// What a tap on a scheduled session shows: the details in one glance. No
// directions: child addresses aren't captured.

const pad = (n: number) => String(n).padStart(2, "0");
const toMins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const time12 = (t: string) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`; };
const range12 = (a: string, b: string) => {
  const x = time12(a), y = time12(b);
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}`;
};
const lengthLabel = (mins: number) => {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
};
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

function Row({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface-sunken text-ink-muted">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
        <div className="text-[16px] font-semibold text-ink [overflow-wrap:anywhere]">{children}</div>
      </div>
    </div>
  );
}

export function SessionDetailsDialog({ session, onOpenChange, onOpenChild, onLogSession }: SessionDetailsDialogProps) {
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dateIso = session?.session_date.split("T")[0] ?? "";
  const isToday = dateIso === todayIso;
  const [y, m, d] = dateIso ? dateIso.split("-").map(Number) : [0, 1, 1];
  const longDate = dateIso ? new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";
  const first = cap(session?.patient_first_name);
  const name = `${first} ${cap(session?.patient_last_name)}`.trim();

  return (
    <Dialog open={!!session} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[22px] p-0">
        {session && (
          <>
            <div className="rounded-t-[22px] bg-primary px-5 pb-5 pt-5 text-primary-fg">
              <p className="text-[13px] font-bold uppercase tracking-wide opacity-80">{isToday ? "Today" : "Scheduled session"}</p>
              <DialogTitle className="mt-1 text-[24px] font-extrabold leading-tight text-primary-fg">{name}</DialogTitle>
              <DialogDescription className="mt-1 text-[16px] font-semibold text-primary-fg opacity-90">{longDate}</DialogDescription>
            </div>

            <div className="space-y-4 px-5 py-5">
              <Row icon={Clock} label="Time">
                <span className="tabular">{range12(session.start_time.slice(0, 5), session.end_time.slice(0, 5))}</span>
                <span className="ml-2 rounded-full bg-surface-sunken px-2 py-0.5 text-[13px] font-bold text-ink-muted">
                  {lengthLabel(toMins(session.end_time) - toMins(session.start_time))}
                </span>
              </Row>
              {session.location && <Row icon={MapPin} label="Location">{session.location}</Row>}
              {session.notes && <Row icon={StickyNote} label="Note"><span className="whitespace-pre-line font-medium">{session.notes}</span></Row>}
              {session.parent_notified_at ? (
                <p className="flex items-center gap-2 rounded-[12px] bg-success-bg px-3 py-2 text-[14px] font-semibold text-success">
                  <CalendarCheck className="size-4 shrink-0" aria-hidden="true" /> Calendar invite sent to the parent
                </p>
              ) : (
                <p className="flex items-center gap-2 rounded-[12px] bg-surface-sunken px-3 py-2 text-[14px] font-semibold text-ink-muted">
                  <CalendarX className="size-4 shrink-0" aria-hidden="true" /> No calendar invite sent
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 px-5 pb-5">
              {isToday && (
                <Button className="h-[56px] w-full rounded-[16px] text-[17px] font-extrabold" onClick={onLogSession}>Log this session</Button>
              )}
              <Button variant={isToday ? "outline" : "primary"} className="h-[56px] w-full rounded-[16px] text-[17px] font-extrabold" onClick={onOpenChild}>
                Open {first}&apos;s page
              </Button>
              <Button variant="ghost" className="h-[48px] w-full text-[16px] font-bold" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
