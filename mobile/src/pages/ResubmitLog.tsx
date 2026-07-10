import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/Picker";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { calculateTotalMinutes, formatSafeDate } from "@/utils/time";
import { SERVICE_TYPE_OPTIONS, STATUS_CODE_OPTIONS, LOCATION_CODE_OPTIONS } from "@/constants/njeis";
import type { ApiErrorBody } from "@/types";

// Signatures are not re-collected here — the resubmit payload only carries
// the assessment ID and revised fields (design: Resubmit Log).
export default function ResubmitLog() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { rejectedLogs, fetchRejectedLogs } = useAppData();
  const { showToast } = useToast();

  const log = rejectedLogs.find((l) => l.id === id);

  const [form, setForm] = React.useState({
    type: log?.type ?? "",
    location: log?.location ?? "",
    start_time: log?.start_time ?? "",
    end_time: log?.end_time ?? "",
    status: log?.status ?? "",
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const totalMinutes = calculateTotalMinutes(form.start_time, form.end_time);

  if (!log) {
    return (
      <PushScreen>
        <AppBar title="Resubmit log" />
        <div className="flex-1 px-4 py-6">
          <InlineErrorBanner
            message="This log is no longer available. It may have already been resubmitted."
            onRetry={fetchRejectedLogs}
          />
        </div>
      </PushScreen>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/patients/resubmit-log", {
        assessmentId: log.id,
        total_time: totalMinutes,
        ...form,
      });
      showToast("Log resubmitted for review.");
      await fetchRejectedLogs();
      navigate("/inbox", { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Failed to resubmit. Please try again.");
      // Race-condition edge case: don't assume success, refresh the inbox.
      await fetchRejectedLogs();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Resubmit log" />
      <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
        <div className="rounded-card border border-warning-border bg-warning-bg p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">Admin note</p>
          <p className="mt-1 text-sm text-warning">{log.rejection_note || "No note provided."}</p>
          <p className="tabular mt-1 text-xs text-warning/80">Returned {formatSafeDate(log.rejected_at)}</p>
        </div>

        {error && <InlineErrorBanner message={error} />}

        <Picker
          id="type"
          label="Service type"
          value={form.type}
          options={SERVICE_TYPE_OPTIONS}
          onChange={(v) => setForm((f) => ({ ...f, type: v }))}
        />
        <Picker
          id="location"
          label="Location"
          value={form.location}
          options={LOCATION_CODE_OPTIONS}
          onChange={(v) => setForm((f) => ({ ...f, location: v }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field id="start_time" label="Start time">
            <Input
              type="time"
              value={form.start_time}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
            />
          </Field>
          <Field id="end_time" label="End time">
            <Input
              type="time"
              value={form.end_time}
              onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
            />
          </Field>
        </div>
        <div>
          <p className="text-[13px] font-medium leading-[18px] text-ink-body">Total time</p>
          <p className="tabular mt-1.5 text-lg font-semibold text-ink" aria-live="polite">
            {totalMinutes > 0 ? `${(totalMinutes / 60).toFixed(2)} hrs (${totalMinutes} min)` : "—"}
          </p>
        </div>
        <Picker
          id="status"
          label="Status"
          value={form.status}
          options={STATUS_CODE_OPTIONS}
          onChange={(v) => setForm((f) => ({ ...f, status: v }))}
        />

        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Resubmit for review
        </Button>
      </form>
    </PushScreen>
  );
}
