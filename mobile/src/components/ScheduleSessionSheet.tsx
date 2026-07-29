import * as React from "react";
import api from "@/api/axiosInstance";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/Picker";
import { useToast } from "@/components/ui/toast";
import { formatTime12h } from "@/utils/time";
import type { ScheduledSession, ApiErrorBody } from "@/types";

interface ScheduleSessionSheetProps {
  /** Non-null opens the sheet. Pass an existing session to reschedule it, or `"new"` to create one. */
  target: ScheduledSession | "new" | null;
  patientId: string;
  parentEmail?: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const EMPTY = { sessionDate: "", startTime: "", endTime: "", location: "", notes: "" };

// Local YYYY-MM-DD (not toISOString, which shifts to UTC and can drop to
// yesterday's date for practitioners west of UTC in the evening) — mirrors
// AppDataContext's fetchUpcomingSessions.
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

// 15-minute increments across the full day. A custom picker (not the native
// <input type="time">) is used deliberately — mobile browsers only open a
// native date/time picker on a direct tap, so a value picked here can't
// reliably auto-open the *next* native picker (showPicker() chaining from
// another field's onChange is inconsistent across iOS Safari/Android
// WebViews). This Sheet-based picker is fully our own state, so opening the
// next one programmatically always works.
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const totalMinutes = i * 15;
  const code = `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  return { code, label: formatTime12h(code) };
});

// One sheet handles both scheduling a new session and rescheduling an
// existing one (mirrors the AddPatient/EditPatient "same form, different
// verb" pattern already used elsewhere in this app).
export function ScheduleSessionSheet({ target, patientId, parentEmail, onOpenChange, onSaved }: ScheduleSessionSheetProps) {
  const { showToast } = useToast();
  const isReschedule = target && target !== "new";
  const [form, setForm] = React.useState(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [startTimeOpen, setStartTimeOpen] = React.useState(false);
  const [endTimeOpen, setEndTimeOpen] = React.useState(false);

  React.useEffect(() => {
    if (isReschedule) {
      setForm({
        sessionDate: target.session_date.split("T")[0],
        startTime: target.start_time.slice(0, 5),
        endTime: target.end_time.slice(0, 5),
        location: target.location || "",
        notes: target.notes || "",
      });
    } else if (target === "new") {
      setForm(EMPTY);
    }
    setError(null);
  }, [target, isReschedule]);

  const setField = <K extends keyof typeof EMPTY>(key: K, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.sessionDate || !form.startTime || !form.endTime) {
      setError("Date, start time, and end time are required.");
      return;
    }
    if (form.sessionDate < todayIso()) {
      setError("Session date can't be in the past.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isReschedule) {
        await api.patch(`/api/schedule/${target.id}`, form);
        showToast("Session rescheduled.");
      } else {
        await api.post("/api/schedule", { patientId, ...form });
        showToast("Session scheduled.");
      }
      onSaved();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Failed to save. Please try again.");
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
              <SheetTitle id="schedule-title">{isReschedule ? "Reschedule session" : "Schedule a session"}</SheetTitle>
              <SheetDescription>
                {parentEmail
                  ? "The parent will get an email with a calendar invite."
                  : "No parent email on file — this patient's record won't get an emailed invite."}
              </SheetDescription>
            </SheetHeader>

            <div className="mb-4 space-y-3">
              <Field id="sessionDate" label="Date">
                <Input
                  type="date"
                  min={todayIso()}
                  value={form.sessionDate}
                  onChange={(e) => {
                    setField("sessionDate", e.target.value);
                    // Guides straight into Start time next — Location/Notes
                    // are left alone, those two stay tap-to-fill.
                    if (e.target.value) setStartTimeOpen(true);
                  }}
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Picker
                  id="startTime"
                  label="Start time"
                  value={form.startTime}
                  options={TIME_OPTIONS}
                  open={startTimeOpen}
                  onOpenChange={setStartTimeOpen}
                  placeholder="Select time"
                  onChange={(code) => {
                    setField("startTime", code);
                    setEndTimeOpen(true);
                  }}
                />
                <Picker
                  id="endTime"
                  label="End time"
                  value={form.endTime}
                  options={TIME_OPTIONS}
                  open={endTimeOpen}
                  onOpenChange={setEndTimeOpen}
                  placeholder="Select time"
                  onChange={(code) => setField("endTime", code)}
                />
              </div>
              <Field id="location" label="Location" optional>
                <Input value={form.location} onChange={(e) => setField("location", e.target.value)} />
              </Field>
              <Field id="notes" label="Notes" optional>
                <Textarea rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
              </Field>

              {error && (
                <p role="alert" className="text-sm font-medium text-danger">
                  {error}
                </p>
              )}
            </div>

            <Button className="w-full" onClick={handleSubmit} loading={submitting}>
              {isReschedule ? "Save changes" : "Schedule session"}
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
