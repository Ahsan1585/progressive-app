import * as React from "react";
import api from "@/api/axiosInstance";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate, formatTime12h } from "@/utils/time";
import { serviceTypeMap } from "@/constants/njeis";
import type { RejectedLog, ApiErrorBody } from "@/types";

interface AcknowledgeDeclineSheetProps {
  log: RejectedLog | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Deliberately lighter-weight than Resubmit — a single action, one optional
// field, no edit fields (design: Acknowledge Decline).
export function AcknowledgeDeclineSheet({ log, onOpenChange, onSuccess }: AcknowledgeDeclineSheetProps) {
  const { showToast } = useToast();
  const [response, setResponse] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (log) {
      setResponse("");
      setError(null);
    }
  }, [log]);

  const handleAcknowledge = async () => {
    if (!log) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/patients/acknowledge-log", {
        assessmentId: log.id,
        response: response.trim() || undefined,
      });
      showToast("Log acknowledged.");
      onSuccess();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Failed to acknowledge. Please try again.");
      // Race-condition edge case: refresh the inbox rather than assuming success.
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={!!log} onOpenChange={onOpenChange}>
      <SheetContent aria-labelledby="acknowledge-title">
        {log && (
          <>
            <SheetHeader>
              <SheetTitle id="acknowledge-title">Acknowledge declined log</SheetTitle>
              <SheetDescription>This log was permanently declined and can't be edited.</SheetDescription>
            </SheetHeader>

            <div className="mb-4 space-y-3">
              <div className="rounded-card border border-danger-border bg-danger-bg p-3.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-danger">Billing note</p>
                <p className="mt-1 text-sm text-danger">{log.rejection_note || "No note provided."}</p>
              </div>

              <div className="rounded-card border border-border bg-surface-sunken p-3.5 text-sm text-ink-body">
                <p className="font-semibold capitalize text-ink">
                  {log.patient_first_name} {log.patient_last_name}
                </p>
                <p className="tabular mt-1 text-xs text-ink-muted">
                  {formatSafeDate(log.service_date)} · {formatTime12h(log.start_time)} - {formatTime12h(log.end_time)}
                </p>
                <p className="mt-1 text-xs text-ink-muted">{serviceTypeMap[log.type] || log.type}</p>
              </div>

              <div>
                <Label htmlFor="ack-response">Your response (optional)</Label>
                <Textarea
                  id="ack-response"
                  rows={3}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="Add a note for the admin before acknowledging..."
                />
              </div>

              {error && (
                <p role="alert" className="text-sm font-medium text-danger">
                  {error}
                </p>
              )}
            </div>

            <Button className="w-full" onClick={handleAcknowledge} loading={submitting}>
              Acknowledge
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
