import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import type { AgencyStage, AgencySummary, AgencyTrendPoint } from "@/types";
import { money, moneyShort, monthLabel, plural, shortDate } from "./format";

// Agency practitioner Home dashboard: the picked month's money (submitted,
// invoiced, paid), where every note stands, what is owed across all months, and
// a six-month trend. Dollars are hours x the practitioner's own pay rate.

const STAGES: { key: AgencyStage; label: string; color: string }[] = [
  { key: "awaiting", label: "Awaiting review", color: "bg-blue-300" },
  { key: "approved", label: "Approved", color: "bg-blue-500" },
  { key: "invoiced", label: "Invoiced", color: "bg-blue-800" },
  { key: "paid", label: "Paid", color: "bg-emerald-600" },
  { key: "returned", label: "Returned to you", color: "bg-red-600" },
  { key: "onHold", label: "On hold", color: "bg-amber-500" },
  { key: "declined", label: "Not billable", color: "bg-slate-400" },
];

interface AgencyDashboardProps {
  summary: AgencySummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onMonthChange: (delta: number) => void;
  canGoNext: boolean;
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[12.5px] font-extrabold uppercase tracking-[0.07em] text-ink", className)}>{children}</p>;
}

function TrendChart({ points, metric, currentMonth }: { points: AgencyTrendPoint[]; metric: "value" | "hours"; currentMonth: string }) {
  const W = 340, H = 170, padB = 26, padT = 22, bw = 22, gap = 4;
  const max = Math.max(1, ...points.map((p) => (metric === "value" ? Math.max(p.submittedValue, p.paidValue) : p.hours)));
  const step = W / points.length;
  const y = (v: number) => H - padB - (v / max) * (H - padB - padT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2.5 block h-auto w-full" role="img" aria-label={metric === "value" ? "Submitted and paid, last six months" : "Hours, last six months"}>
      <line x1="0" x2={W} y1={H - padB} y2={H - padB} className="stroke-border-strong" strokeWidth="1" />
      {points.map((p, i) => {
        const cx = step * i + step / 2;
        const cur = p.month === currentMonth;
        return (
          <g key={p.month}>
            {metric === "value" ? (
              <>
                <rect x={cx - bw - gap / 2} y={y(p.submittedValue)} width={bw} height={H - padB - y(p.submittedValue)} rx="4" className={cur ? "fill-primary" : "fill-blue-300"} />
                <rect x={cx + gap / 2} y={y(p.paidValue)} width={bw} height={H - padB - y(p.paidValue)} rx="4" className="fill-emerald-600" />
                <text x={cx} y={Math.min(y(p.submittedValue), y(p.paidValue)) - 5} textAnchor="middle" fontSize="11" fontWeight="700" className="fill-ink font-mono">{moneyShort(p.submittedValue)}</text>
              </>
            ) : (
              <>
                <rect x={cx - bw / 2} y={y(p.hours)} width={bw} height={H - padB - y(p.hours)} rx="4" className={cur ? "fill-primary" : "fill-blue-300"} />
                <text x={cx} y={y(p.hours) - 5} textAnchor="middle" fontSize="11" fontWeight="700" className="fill-ink font-mono">{Math.round(p.hours)}h</text>
              </>
            )}
            <text x={cx} y={H - 6} textAnchor="middle" fontSize="13" fontWeight={cur ? 800 : 600} className={cur ? "fill-ink" : "fill-ink-muted"}>{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function AgencyDashboard({ summary, loading, error, onRetry, onMonthChange, canGoNext }: AgencyDashboardProps) {
  const [openStage, setOpenStage] = React.useState<AgencyStage | null>(null);
  const [metric, setMetric] = React.useState<"value" | "hours">("value");
  React.useEffect(() => { setOpenStage(null); }, [summary?.month]);

  if (error && !summary) return <InlineErrorBanner message={error} onRetry={onRetry} />;
  if (loading && !summary) {
    return (
      <div aria-label="Loading your dashboard" className="space-y-4">
        <div className="grid grid-cols-3 gap-2.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[92px] w-full rounded-[18px]" />)}</div>
        <Skeleton className="h-[150px] w-full rounded-card" />
        <Skeleton className="h-[120px] w-full rounded-card" />
      </div>
    );
  }
  if (!summary) return null;

  const s = summary;
  const monthName = monthLabel(s.month, "short");
  const b = s.breakdown;
  const lines: { label: string; color: string; value: number }[] = [
    { label: "In progress", color: "bg-blue-500", value: b.awaiting.value + b.approved.value },
    { label: "Invoiced, not yet paid", color: "bg-blue-800", value: b.invoiced.value },
    { label: "Paid", color: "bg-emerald-600", value: b.paid.value },
    { label: "Waiting on your fix", color: "bg-red-600", value: b.returned.value },
    { label: "Paused by the office", color: "bg-amber-500", value: b.onHold.value },
    { label: "Not billable", color: "bg-slate-400", value: b.declined.value },
  ].filter((l) => l.value > 0);
  const stagesWithNotes = STAGES.filter((st) => b[st.key].count > 0);

  return (
    <div className="space-y-5">
      {/* month + tiles + where the money is */}
      <section aria-label="Your notes">
        <div className="flex items-center justify-between">
          <SectionLabel>Your notes</SectionLabel>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous month" onClick={() => onMonthChange(-1)} className="press-scale flex size-[38px] items-center justify-center rounded-[12px] border-[1.5px] border-border-strong bg-surface text-ink">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <p className="min-w-[132px] text-center text-base font-extrabold text-ink">{monthLabel(s.month)}</p>
            <button type="button" aria-label="Next month" disabled={!canGoNext} onClick={() => onMonthChange(1)} className="press-scale flex size-[38px] items-center justify-center rounded-[12px] border-[1.5px] border-border-strong bg-surface text-ink disabled:opacity-35">
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {!s.hasPayRate && (
          <p className="mt-3 rounded-control border border-warning-border bg-warning-bg px-3 py-2 text-[13px] font-semibold text-warning">
            Your pay rate isn't set up yet, so amounts show as $0. Ask your office to add it.
          </p>
        )}

        <div role="group" aria-label="This month" className={cn("mt-3 grid grid-cols-3 gap-2.5", loading && "opacity-60")}>
          <div className="rounded-[18px] border-[1.5px] border-ink bg-ink px-3 py-3.5 text-bg">
            <p className="text-[11.5px] font-extrabold uppercase tracking-[0.07em]">Submitted</p>
            <p className="tabular mt-2 text-[25px] font-extrabold leading-none tracking-tight">{moneyShort(s.tiles.submitted.value)}</p>
            <p className="mt-1 text-[12.5px] font-semibold">{s.tiles.submitted.count} {plural(s.tiles.submitted.count, "note")} · {s.tiles.submitted.hours.toFixed(1)}h</p>
          </div>
          <div className="rounded-[18px] border-[1.5px] border-border bg-surface px-3 py-3.5">
            <p className="text-[11.5px] font-extrabold uppercase tracking-[0.07em] text-ink">Invoiced</p>
            <p className="tabular mt-2 text-[25px] font-extrabold leading-none tracking-tight text-ink">{moneyShort(s.tiles.invoiced.value)}</p>
            <p className="mt-1 text-[12.5px] font-semibold text-ink-body">{s.tiles.invoiced.count} {plural(s.tiles.invoiced.count, "note")}</p>
          </div>
          <div className="rounded-[18px] border-[1.5px] border-success bg-success-bg px-3 py-3.5">
            <p className="text-[11.5px] font-extrabold uppercase tracking-[0.07em] text-success">Paid</p>
            <p className="tabular mt-2 text-[25px] font-extrabold leading-none tracking-tight text-success">{moneyShort(s.tiles.paid.value)}</p>
            <p className="mt-1 text-[12.5px] font-semibold text-ink-body">{s.tiles.paid.count} {plural(s.tiles.paid.count, "note")}</p>
          </div>
        </div>

        {s.tiles.submitted.count === 0 ? (
          <p className="mt-4 text-sm font-semibold text-ink-muted">No session notes in {monthName} yet.</p>
        ) : (
          <ul aria-label="Where this month's notes are" className="mt-4 space-y-2.5">
            {lines.map((l) => (
              <li key={l.label} className="flex items-center justify-between gap-3 text-[14.5px]">
                <span className="flex items-center gap-2 font-semibold text-ink"><span className={cn("size-3 shrink-0 rounded-[4px]", l.color)} aria-hidden="true" />{l.label}</span>
                <span className="tabular font-mono font-bold text-ink">{money(l.value)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 border-t-2 border-ink pt-2.5">
              <span className="text-[15.5px] font-extrabold text-ink">Submitted in {monthName}</span>
              <span className="tabular font-mono text-base font-extrabold text-ink">{money(s.tiles.submitted.value)}</span>
            </li>
          </ul>
        )}
      </section>

      {/* owed across all months */}
      <section aria-label="Owed to you" className="rounded-card bg-blue-700 p-4 text-white">
        <p className="text-[12.5px] font-extrabold uppercase tracking-[0.07em] opacity-90">Owed to you · all months</p>
        <p className="tabular mt-2.5 text-[40px] font-extrabold leading-none tracking-tight">{money(s.owed.value)}</p>
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold">In progress <b className="font-mono font-extrabold">{money(s.owed.inProgress)}</b></span>
          <span className="rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold">Invoiced, unpaid <b className="font-mono font-extrabold">{money(s.owed.invoicedUnpaid)}</b></span>
          {s.owed.onHold > 0 && <span className="rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold">On hold <b className="font-mono font-extrabold">{money(s.owed.onHold)}</b></span>}
        </div>
        {s.waitingOnFix.value > 0 && (
          <p className="mt-3 inline-block rounded-full bg-red-600 px-3 py-1.5 text-[13px] font-bold">+ {money(s.waitingOnFix.value)} more once your returned notes are fixed</p>
        )}
      </section>

      {/* progress by stage */}
      {stagesWithNotes.length > 0 && (
        <section aria-label="Progress" className="rounded-card border-[1.5px] border-border bg-surface p-4">
          <SectionLabel>Progress · {monthName}</SectionLabel>
          <div className="mt-3.5 flex h-[26px] gap-[3px] overflow-hidden rounded-[12px] bg-surface-sunken" aria-hidden="true">
            {stagesWithNotes.map((st) => (
              <span key={st.key} className={cn("min-w-[6px]", st.color)} style={{ flexGrow: b[st.key].count }} />
            ))}
          </div>
          <ul role="list" className="mt-2.5 space-y-0.5">
            {stagesWithNotes.map((st) => {
              const open = openStage === st.key;
              const notes = s.monthNotes.filter((n) => n.stage === st.key);
              return (
                <li key={st.key}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${st.label}, ${b[st.key].count} ${plural(b[st.key].count, "note")}, ${money(b[st.key].value)}`}
                    onClick={() => setOpenStage(open ? null : st.key)}
                    className={cn("press-scale grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-control px-2 py-2.5 text-left text-[15px] font-bold text-ink", open && "bg-surface-sunken")}
                  >
                    <span className={cn("size-3 rounded-[4px]", st.color)} aria-hidden="true" />
                    <span>{st.label}</span>
                    <span className="tabular font-mono text-sm font-extrabold">{b[st.key].count}</span>
                    <span className="tabular min-w-[64px] text-right font-mono text-[14.5px] font-extrabold">{money(b[st.key].value)}</span>
                  </button>
                  {open && (
                    <ul role="list" className="mx-2 mb-2 mt-1 space-y-1.5 border-t border-dashed border-border-strong pt-2">
                      {notes.map((n) => (
                        <li key={n.id} className="flex justify-between gap-3 text-[13.5px] text-ink">
                          <span className="min-w-0 truncate capitalize">{shortDate(n.serviceDate)} · {n.childName}{n.minutes === 0 ? " · cancelled, 0 min" : ""}</span>
                          <span className="tabular shrink-0 font-mono">{money(n.value)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* declined: visible, collapsed, nothing to do */}
      {s.declined.length > 0 && (
        <details className="group rounded-[16px] border-[1.5px] border-border bg-surface px-4 py-3.5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[14.5px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span>Not billable in {monthName}: <b>{s.declined.length} {plural(s.declined.length, "note")} · {money(b.declined.value)}</b></span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          {s.declined.map((n) => (
            <p key={n.id} className="mt-2 text-sm text-ink-body"><b className="capitalize text-ink">{n.childName} · {shortDate(n.serviceDate)}</b>. Office: {n.reason || "No reason given."}</p>
          ))}
        </details>
      )}

      {/* six-month trend */}
      <section aria-label="Last 6 months" className="rounded-card border-[1.5px] border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <SectionLabel>Last 6 months</SectionLabel>
          <div className="flex rounded-control border border-border-strong p-0.5">
            {(["value", "hours"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}
                className={cn("rounded-[7px] px-3 py-1.5 text-[13px] font-extrabold", metric === m ? "bg-primary text-primary-fg" : "text-ink-muted")}>
                {m === "value" ? "$" : "Hours"}
              </button>
            ))}
          </div>
        </div>
        <TrendChart points={s.trend} metric={metric} currentMonth={s.month} />
        {metric === "value" && (
          <div className="mt-1.5 flex gap-4 text-[13px] font-semibold text-ink">
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-blue-300" aria-hidden="true" />Submitted</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-emerald-600" aria-hidden="true" />Paid</span>
          </div>
        )}
      </section>
    </div>
  );
}
