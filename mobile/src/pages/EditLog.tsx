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
import { calculateTotalMinutes } from "@/utils/time";
import type { Assessment, ApiErrorBody } from "@/types";

// Only for logs still sitting at billing_status "pending" — a "rejected"
// log already has its own dedicated edit+resubmit flow (ResubmitLog.tsx),
// and anything further along the billing pipeline isn't the
// practitioner's record to change anymore (mirrors the backend's
// editLog/deleteLog gate in patientController.js).
export default function EditLog() {
  const { id: patientId, logId } = useParams<{ id: string; logId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { profile, serviceTypeOptions, statusOptions, locationOptions, groupSizeOptions } = useAppData();

  const [loading, setLoading] = React.useState(true);
  const [notEditable, setNotEditable] = React.useState(false);

  const allowedServiceTypeOptions = React.useMemo(() => {
    const allowed = profile?.service_types;
    if (!allowed || allowed.length === 0) return serviceTypeOptions;
    return serviceTypeOptions.filter((opt) => allowed.includes(opt.code));
  }, [profile, serviceTypeOptions]);

  const [form, setForm] = React.useState({
    date: "",
    startTime: "",
    endTime: "",
    status: "",
    type: "",
    location: "",
    groupSizeCategory: "individual",
  });
  const [zeroTime, setZeroTime] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!patientId || !logId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<Assessment[]>(`/api/patients/${patientId}/assessments`);
        const found = res.data.find((a) => String(a.id) === logId) || null;
        if (!found || found.billing_status !== "pending") {
          setNotEditable(true);
        } else {
          setForm({
            date: found.service_date,
            startTime: found.start_time || "",
            endTime: found.end_time || "",
            status: found.status || "",
            type: found.type || "",
            location: found.location || "",
            groupSizeCategory: found.group_size_category || "individual",
          });
          setZeroTime(!found.start_time && !found.end_time);
        }
      } catch {
        setNotEditable(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [patientId, logId]);

  const totalMinutes = calculateTotalMinutes(form.startTime, form.endTime);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleZeroTimeToggle = (checked: boolean) => {
    setZeroTime(checked);
    setForm((f) => ({ ...f, startTime: "", endTime: "" }));
  };

  const missing: string[] = [];
  if (!form.date) missing.push("date");
  if (!zeroTime && !form.startTime) missing.push("start time");
  if (!zeroTime && !form.endTime) missing.push("end time");
  if (!form.type) missing.push("service type");
  if (!form.status) missing.push("status");
  if (!form.location) missing.push("location");

  const handleSubmit = async () => {
    if (!logId || missing.length > 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.put(`/api/patients/logs/${logId}`, {
        service_date: form.date,
        start_time: form.startTime || null,
        end_time: form.endTime || null,
        status: form.status,
        type: form.type,
        location: form.location,
        group_size_category: form.groupSizeCategory,
        total_time: totalMinutes,
      });
      showToast("Log updated.");
      navigate(`/patients/${patientId}`, { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "There was an error saving your changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Edit Log" onBack={() => navigate(-1)} />

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 pb-28">
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : notEditable ? (
          <InlineErrorBanner message="This log can no longer be edited — it may have already moved into billing review, or it's a returned log (edit it from your Inbox instead)." />
        ) : (
          <>
            {error && <InlineErrorBanner message={error} />}

            <Field id="date" label="Service date">
              <Input type="date" value={form.date} onChange={(e) => setField("date", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="startTime" label="Start time">
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setField("startTime", e.target.value)}
                  disabled={zeroTime}
                />
              </Field>
              <Field id="endTime" label="End time">
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setField("endTime", e.target.value)}
                  disabled={zeroTime}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 text-[13px] font-medium text-ink-body">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-strong"
                checked={zeroTime}
                onChange={(e) => handleZeroTimeToggle(e.target.checked)}
              />
              Session was cancelled — log with 0 time
            </label>
            <div>
              <p className="text-[13px] font-medium leading-[18px] text-ink-body">Total time</p>
              <p className="tabular mt-1.5 text-lg font-semibold text-ink" aria-live="polite">
                {zeroTime ? "0 min (cancelled)" : totalMinutes > 0 ? `${(totalMinutes / 60).toFixed(2)} hrs (${totalMinutes} min)` : "—"}
              </p>
            </div>

            <Picker
              id="type"
              label="Service type"
              value={form.type}
              options={allowedServiceTypeOptions}
              onChange={(v) => setField("type", v)}
            />
            <Picker
              id="status"
              label="Status"
              value={form.status}
              options={statusOptions}
              onChange={(v) => setField("status", v)}
            />
            <Picker
              id="location"
              label="Location"
              value={form.location}
              options={locationOptions}
              onChange={(v) => setField("location", v)}
            />
            <Picker
              id="groupSizeCategory"
              label="Group size category"
              value={form.groupSizeCategory}
              options={groupSizeOptions}
              onChange={(v) => setField("groupSizeCategory", v)}
            />
          </>
        )}
      </div>

      {!loading && !notEditable && (
        <div className="safe-bottom sticky bottom-0 z-20 border-t border-border bg-surface px-4 py-3 shadow-[var(--elev-raised)]">
          {missing.length > 0 && (
            <p className="tabular mb-2 text-xs font-medium text-ink-muted">
              {missing.length} field{missing.length > 1 ? "s" : ""} still missing
            </p>
          )}
          <Button className="w-full" size="lg" onClick={handleSubmit} loading={submitting} disabled={submitting || missing.length > 0}>
            Save changes
          </Button>
        </div>
      )}
    </PushScreen>
  );
}
