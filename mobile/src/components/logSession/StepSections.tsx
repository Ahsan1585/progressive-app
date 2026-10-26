import * as React from "react";
import { Mic, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { BigOptions } from "@/components/logSession/BigOptions";
import { joinWords } from "@/utils/logSessionSteps";
import { localNowHHMM, addMinutesToTime, localTodayIso } from "@/utils/time";
import { cn } from "@/lib/utils";
import type { DropdownOption } from "@/types";

// Big, bold step sections shared by Log Session and Edit Log, so both screens
// look and behave the same: large labels, 60px inputs, tap-button choices.

const bigInput = "h-[62px] rounded-[16px] border-2 px-4 text-[21px] font-bold";
const chip = "press-scale min-h-[50px] rounded-full border-2 border-border-strong bg-surface px-4 text-[16.5px] font-bold text-ink disabled:opacity-40";
const chipOn = "border-primary bg-primary text-primary-fg";

export const yesterdayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const totalTimeLabel = (zeroTime: boolean, totalMinutes: number) =>
  zeroTime
    ? "0 min (cancelled)"
    : totalMinutes > 0
      ? `${Math.floor(totalMinutes / 60) ? `${Math.floor(totalMinutes / 60)} h ` : ""}${totalMinutes % 60 ? `${totalMinutes % 60} min` : ""}`.trim()
      : "—";

export function StepHeader({ title, index, total, optional }: { title: string; index: number; total: number; optional?: boolean }) {
  return (
    <div className="mb-5">
      <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-ink">{title}</h2>
      <p className="mt-0.5 text-[15px] font-medium text-ink-muted">Step {index + 1} of {total}{optional ? " · Optional" : ""}</p>
    </div>
  );
}

interface TimeFieldsProps {
  date: string;
  startTime: string;
  endTime: string;
  zeroTime: boolean;
  totalMinutes: number;
  onDate: (v: string) => void;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  onZeroTime: (v: boolean) => void;
  errorFor: (key: string) => boolean;
  /** extra content shown above the date (Log Session's In person / Video choice) */
  before?: React.ReactNode;
}

export function TimeFields({ date, startTime, endTime, zeroTime, totalMinutes, onDate, onStart, onEnd, onZeroTime, errorFor, before }: TimeFieldsProps) {
  return (
    <div className="flex flex-col gap-6">
      {before}
      <div className="flex flex-col gap-2.5">
        <label htmlFor="date" className="flex items-baseline justify-between text-[18px] font-extrabold text-ink">Service date<span className="text-sm font-semibold text-danger">Required</span></label>
        <Input id="date" type="date" className={bigInput} value={date} onChange={(e) => onDate(e.target.value)} required />
        <div className="flex flex-wrap gap-2.5">
          <button type="button" className={cn(chip, date === localTodayIso() && chipOn)} onClick={() => onDate(localTodayIso())}>Today</button>
          <button type="button" className={cn(chip, date === yesterdayIso() && chipOn)} onClick={() => onDate(yesterdayIso())}>Yesterday</button>
        </div>
        {errorFor("the date") && <p className="text-sm font-semibold text-danger">Pick the service date.</p>}
      </div>

      <div className="flex flex-col gap-2.5">
        <p className="flex items-baseline justify-between text-[18px] font-extrabold text-ink">Time<span className="text-sm font-semibold text-danger">{zeroTime ? "" : "Required"}</span></p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-bold text-ink-muted">Start
            <Input type="time" className={cn(bigInput, "text-[19px]")} value={startTime} onChange={(e) => onStart(e.target.value)} disabled={zeroTime} aria-invalid={errorFor("a start time")} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold text-ink-muted">End
            <Input type="time" className={cn(bigInput, "text-[19px]")} value={endTime} onChange={(e) => onEnd(e.target.value)} disabled={zeroTime} aria-invalid={errorFor("an end time") || errorFor("an end time after the start")} />
          </label>
        </div>
        {!zeroTime && (
          <div className="flex flex-wrap gap-2.5">
            <button type="button" className={chip} onClick={() => onStart(localNowHHMM())}>Start now</button>
            {[15, 30, 45, 60].map((mins) => (
              <button key={mins} type="button" className={chip} disabled={!startTime} onClick={() => onEnd(addMinutesToTime(startTime, mins))}>{mins} min</button>
            ))}
          </div>
        )}
        {(errorFor("a start time") || errorFor("an end time")) && <p className="text-sm font-semibold text-danger">Add both the start and end time.</p>}
        {errorFor("an end time after the start") && <p className="text-sm font-semibold text-danger">The end time must be after the start time.</p>}
      </div>

      <button type="button" role="switch" aria-checked={zeroTime} onClick={() => onZeroTime(!zeroTime)}
        className={cn("press-scale flex min-h-[64px] items-center gap-3 rounded-[16px] border-2 px-4 text-left", zeroTime ? "border-primary bg-primary-tint" : "border-border-strong bg-surface")}>
        <span className="flex-1">
          <span className="block text-[17px] font-bold text-ink">Session was cancelled</span>
          <span className="block text-sm font-medium text-ink-muted">Logs it with 0 time</span>
        </span>
        <span className={cn("relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors", zeroTime ? "bg-primary" : "bg-border-strong")} aria-hidden="true">
          <span className={cn("absolute top-[3px] size-6 rounded-full bg-white transition-transform", zeroTime ? "translate-x-[25px]" : "translate-x-[3px]")} />
        </span>
      </button>

      <div className="flex items-center justify-between rounded-[16px] bg-surface-sunken px-4 py-4">
        <span className="text-base font-bold text-ink-muted">Total time</span>
        <span className="tabular font-mono text-[26px] font-extrabold text-ink" aria-live="polite">{totalTimeLabel(zeroTime, totalMinutes)}</span>
      </div>
    </div>
  );
}

interface CustomCategory {
  key: string;
  display_name: string;
  is_required_on_log?: boolean;
}

interface CodeFieldsProps {
  type: string;
  status: string;
  location: string;
  groupSizeCategory: string;
  customFields: Record<string, string>;
  serviceTypeOptions: DropdownOption[];
  statusOptions: DropdownOption[];
  locationOptions: DropdownOption[];
  groupSizeOptions: DropdownOption[];
  customCategories: CustomCategory[];
  dropdownOptions: Record<string, DropdownOption[]>;
  onField: (key: "type" | "status" | "location" | "groupSizeCategory", value: string) => void;
  onCustomField: (key: string, value: string) => void;
  errorFor: (key: string) => boolean;
  /** e.g. "Filled in from Leo's last session." */
  prefilledNote?: string | null;
  /** extra fields after group size (independent practitioners' agency) */
  extra?: React.ReactNode;
}

export function CodeFields(p: CodeFieldsProps) {
  return (
    <div className="flex flex-col gap-6">
      {p.prefilledNote && (
        <p className="flex items-center gap-2.5 rounded-[14px] border-2 border-dashed border-primary bg-primary-tint px-3.5 py-3 text-[15px] font-bold text-primary">
          <RotateCcw className="size-5 shrink-0" aria-hidden="true" />
          {p.prefilledNote}
        </p>
      )}
      <BigOptions label="Service type" required value={p.type} options={p.serviceTypeOptions} onChange={(v) => p.onField("type", v)} error={p.errorFor("a service type") ? "Pick the service type." : null} />
      <BigOptions label="Status" required value={p.status} options={p.statusOptions} onChange={(v) => p.onField("status", v)} error={p.errorFor("a status") ? "Pick the status." : null} />
      <BigOptions label="Location" required layout="grid" value={p.location} options={p.locationOptions} onChange={(v) => p.onField("location", v)} error={p.errorFor("a location") ? "Pick the location." : null} />
      <BigOptions label="Group size" layout="grid" value={p.groupSizeCategory} options={p.groupSizeOptions} onChange={(v) => p.onField("groupSizeCategory", v)} />
      {p.extra}
      {p.customCategories.map((cat) => (
        <BigOptions
          key={cat.key}
          label={cat.display_name}
          required={!!cat.is_required_on_log}
          value={p.customFields[cat.key] || ""}
          options={(p.dropdownOptions[cat.key] || []).filter((o) => o.is_active)}
          onChange={(v) => p.onCustomField(cat.key, v)}
          error={p.errorFor(cat.display_name.toLowerCase()) ? `${cat.display_name} is required.` : null}
        />
      ))}
    </div>
  );
}

export function NotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <label htmlFor="note" className="flex items-baseline justify-between text-[18px] font-extrabold text-ink">What happened in the session?<span className="text-sm font-semibold text-ink-muted">Optional</span></label>
      <Textarea
        id="note"
        className="min-h-[240px] rounded-[16px] border-2 px-4 py-3 text-[18px] leading-relaxed"
        placeholder="Activities, progress toward IFSP outcomes, what the family practiced…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-right text-sm font-semibold text-ink-muted">{value.length} characters</p>
      <p className="flex items-start gap-2.5 rounded-[14px] bg-surface-sunken px-3.5 py-3 text-[14.5px] font-semibold text-ink-body">
        <Mic className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        Tip: tap the microphone on your keyboard to dictate instead of typing.
      </p>
    </div>
  );
}

interface StepFooterProps {
  missing: string[];
  showErrors: boolean;
  isFirst: boolean;
  /** label for Next ("Next: Codes") or the final action ("Save changes") */
  primaryLabel: string;
  isFinal: boolean;
  onBack: () => void;
  onPrimary: () => void;
  loading?: boolean;
  disabled?: boolean;
  readyText?: string;
}

export function StepFooter({ missing, showErrors, isFirst, primaryLabel, isFinal, onBack, onPrimary, loading, disabled, readyText }: StepFooterProps) {
  return (
    <div className="safe-bottom sticky bottom-0 z-20 border-t border-border bg-surface px-4 pb-3 pt-2.5 shadow-[var(--elev-raised)]">
      <p className={cn("mb-2 min-h-[22px] text-[15px] font-bold", missing.length ? (showErrors ? "text-danger" : "text-warning") : "text-success")} aria-live="polite">
        {missing.length ? `Add ${joinWords(missing)} to continue` : isFinal ? (readyText || "Everything is ready to save") : "✓ This step is complete"}
      </p>
      <div className={cn("grid gap-2.5", isFirst ? "grid-cols-1" : "grid-cols-[auto_1fr]")}>
        {!isFirst && (
          <Button type="button" variant="subtle" size="lg" className="h-[60px] min-w-[104px] rounded-[18px] text-[18px] font-extrabold" onClick={onBack} disabled={loading}>
            Back
          </Button>
        )}
        {isFinal ? (
          <Button type="button" size="lg" className="h-[60px] rounded-[18px] bg-success text-[18px] font-extrabold text-white hover:bg-success" onClick={onPrimary} loading={loading} disabled={disabled}>
            {primaryLabel}
          </Button>
        ) : (
          <Button type="button" size="lg" className="h-[60px] rounded-[18px] text-[18px] font-extrabold" onClick={onPrimary} aria-disabled={missing.length > 0}>
            {primaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
