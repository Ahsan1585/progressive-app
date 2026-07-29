import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/Picker";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { calculateTotalMinutes, formatSafeDate } from "@/utils/time";
import type { ApiErrorBody } from "@/types";

// Signatures are not re-collected here — the resubmit payload only carries
// the assessment ID and revised fields (design: Resubmit Log).
export default function ResubmitLog() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { rejectedLogs, fetchRejectedLogs, profile, serviceTypeOptions, statusOptions, locationOptions, groupSizeOptions } = useAppData();
  const { showToast } = useToast();

  const log = rejectedLogs.find((l) => String(l.id) === id);

  const allowedServiceTypeOptions = React.useMemo(() => {
    const allowed = profile?.service_types;
    if (!allowed || allowed.length === 0) return serviceTypeOptions;
    return serviceTypeOptions.filter((opt) => allowed.includes(opt.code));
  }, [profile, serviceTypeOptions]);

  const [form, setForm] = React.useState({
    type: log?.type ?? "",
    location: log?.location ?? "",
    start_time: log?.start_time ?? "",
    end_time: log?.end_time ?? "",
    status: log?.status ?? "",
    group_size_category: log?.group_size_category ?? "individual",
    note: "",
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

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

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/api/patients/logs/${log.id}`);
      showToast("Log deleted.");
      await fetchRejectedLogs();
      navigate("/inbox", { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't delete this log. Please try again.");
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
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
          options={allowedServiceTypeOptions}
          onChange={(v) => setForm((f) => ({ ...f, type: v }))}
        />
        <Picker
          id="location"
          label="Location"
          value={form.location}
          options={locationOptions}
          onChange={(v) => setForm((f) => ({ ...f, location: v }))}
        />
        <Picker
          id="group_size_category"
          label="Group size category"
          value={form.group_size_category}
          options={groupSizeOptions}
          onChange={(v) => setForm((f) => ({ ...f, group_size_category: v }))}
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
          options={statusOptions}
          onChange={(v) => setForm((f) => ({ ...f, status: v }))}
        />
        <Field id="note" label="Note to billing" optional>
          <Textarea
            placeholder="Add any context on what you changed..."
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </Field>

        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Resubmit for review
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full text-danger"
          size="lg"
          onClick={() => setConfirmDeleteOpen(true)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete this log
        </Button>
      </form>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this log?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </PushScreen>
  );
}
