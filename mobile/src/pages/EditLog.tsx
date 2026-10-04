import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Send } from "lucide-react";
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
import { calculateTotalMinutes, formatSafeDate } from "@/utils/time";
import type { Assessment, ApiErrorBody, LogNote } from "@/types";

const authorLabel = (n: LogNote) => {
  const name = [n.first_name, n.last_name].filter(Boolean).join(" ");
  if (name) return name;
  return n.author_role.charAt(0).toUpperCase() + n.author_role.slice(1);
};

// Only for logs still sitting at billing_status "pending" (or, for an
// independent practitioner, its own equivalent "self_certified" — no
// SEVF/invoice generated yet) — a "rejected" log already has its own
// dedicated edit+resubmit flow (ResubmitLog.tsx), and anything further
// along the billing pipeline isn't the practitioner's record to change
// anymore (mirrors the backend's editLog/deleteLog gate in
// patientController.js; a "completed" independent-practitioner log's only
// remaining action is Reject, from PatientDetail.tsx directly).
export default function EditLog() {
  const { id: patientId, logId } = useParams<{ id: string; logId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { profile, serviceTypeOptions, statusOptions, locationOptions, groupSizeOptions, dropdownOptions, dropdownCategories } = useAppData();
  const customCategories = React.useMemo(
    () => dropdownCategories.filter((c) => c.is_custom && c.is_active),
    [dropdownCategories]
  );

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
    customFields: {} as Record<string, string>,
  });
  const [zeroTime, setZeroTime] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [notes, setNotes] = React.useState<LogNote[]>([]);
  const [notesLoading, setNotesLoading] = React.useState(true);
  const [newComment, setNewComment] = React.useState("");
  const [addingComment, setAddingComment] = React.useState(false);

  const fetchNotes = React.useCallback(async () => {
    if (!logId) return;
    setNotesLoading(true);
    try {
      const res = await api.get<{ success: boolean; notes: LogNote[] }>(`/api/patients/logs/${logId}/notes`);
      setNotes(res.data.notes || []);
    } catch {
      // Non-critical — the edit form itself still works without the thread.
    } finally {
      setNotesLoading(false);
    }
  }, [logId]);

  React.useEffect(() => {
    if (!patientId || !logId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<Assessment[]>(`/api/patients/${patientId}/assessments`);
        const found = res.data.find((a) => String(a.id) === logId) || null;
        if (!found || !["pending", "self_certified"].includes(found.billing_status)) {
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
            customFields: found.form_data?.custom_fields || {},
          });
          setZeroTime(!found.start_time && !found.end_time);
        }
      } catch {
        setNotEditable(true);
      } finally {
        setLoading(false);
      }
    })();
    fetchNotes();
  }, [patientId, logId, fetchNotes]);

  const handleAddComment = async () => {
    if (!logId || !newComment.trim()) return;
    setAddingComment(true);
    try {
      await api.post(`/api/patients/logs/${logId}/notes`, { note: newComment.trim() });
      setNewComment("");
      await fetchNotes();
      showToast("Comment added.");
    } catch {
      showToast("Couldn't add your comment. Please try again.");
    } finally {
      setAddingComment(false);
    }
  };

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
  for (const cat of customCategories) {
    if (cat.is_required_on_log && !form.customFields[cat.key]) missing.push(cat.display_name.toLowerCase());
  }

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
        custom_fields: form.customFields,
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
            {customCategories.map((cat) => {
              const catOptions = (dropdownOptions[cat.key] || []).filter((o) => o.is_active);
              return (
                <Picker
                  key={cat.key}
                  id={`custom-${cat.key}`}
                  label={cat.display_name}
                  value={form.customFields[cat.key] || ""}
                  options={catOptions}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, customFields: { ...f.customFields, [cat.key]: v } }));
                  }}
                />
              );
            })}

            <div className="border-t border-border pt-5">
              <p className="mb-2 text-[13px] font-medium leading-[18px] text-ink-body">Comments</p>
              {notesLoading ? (
                <p className="text-sm text-ink-muted">Loading…</p>
              ) : notes.length > 0 ? (
                <ul role="list" className="mb-3 space-y-2">
                  {notes.map((n, i) => (
                    <li key={i} className="rounded-card border border-border bg-surface-sunken p-3">
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{authorLabel(n)}</p>
                        <p className="shrink-0 text-xs text-ink-faint">{formatSafeDate(n.created_at)}</p>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-ink-body">{n.note}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-3 text-sm text-ink-muted">No comments yet.</p>
              )}
              <Field id="newComment" label="Add a comment">
                <Textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a note about this session…"
                  rows={3}
                />
              </Field>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 flex items-center gap-1.5"
                onClick={handleAddComment}
                loading={addingComment}
                disabled={addingComment || !newComment.trim()}
              >
                <Send className="size-3.5" aria-hidden="true" />
                Add comment
              </Button>
            </div>
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
