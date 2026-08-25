import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { formatSafeDate, formatTime12h } from "@/utils/time";
import type { ApiErrorBody, TelepracticeSignatureRequestDetail } from "@/types";

// Read-only review of a telepractice session the parent has already signed
// remotely — the practitioner's final check before it becomes a real,
// billing-visible log. Nothing here is editable; if something looks wrong,
// the practitioner has to go back and log a fresh session (this screen
// intentionally mirrors PatientDetail's read-only "Encounter history" item,
// not ResubmitLog's editable form).
export default function ConfirmTelepracticeLog() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { fetchTelepracticeRequests, serviceTypeMap, locationCodeMap, statusCodeMap } = useAppData();
  const { showToast } = useToast();

  const [detail, setDetail] = React.useState<TelepracticeSignatureRequestDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const fetchDetail = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ success: boolean; request: TelepracticeSignatureRequestDetail }>(`/api/telepractice-signatures/${id}`);
      setDetail(res.data.request);
    } catch {
      setError("This request is no longer available.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleConfirm = async () => {
    if (!id) return;
    setConfirming(true);
    try {
      await api.post(`/api/telepractice-signatures/${id}/confirm`);
      showToast("Session confirmed and submitted.");
      await fetchTelepracticeRequests();
      navigate("/inbox", { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't submit this session. Please try again.");
      await fetchTelepracticeRequests();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="Confirm & submit" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {error ? (
          <InlineErrorBanner message={error} onRetry={fetchDetail} />
        ) : loading || !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-card border border-success-border bg-success-bg p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-success">Signed by parent</p>
              <p className="mt-1 text-sm text-success">
                {detail.patient_first_name} {detail.patient_last_name}&apos;s parent has signed this session. Review
                everything below, then confirm to send it to billing.
              </p>
            </div>

            <div className="rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]">
              <p className="tabular text-sm font-semibold text-ink">{formatSafeDate(detail.service_date)}</p>
              <p className="mt-0.5 text-sm text-ink-body">{serviceTypeMap[detail.type] || detail.type}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{locationCodeMap[detail.location] || detail.location}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                <span className="tabular">
                  {formatTime12h(detail.start_time || "")} - {formatTime12h(detail.end_time || "")}
                </span>
                <span className="font-semibold uppercase tracking-wide">{statusCodeMap[detail.session_status] || detail.session_status}</span>
              </div>
              {detail.total_time ? (
                <p className="tabular mt-2 text-sm font-semibold text-ink">{(detail.total_time / 60).toFixed(2)} hrs</p>
              ) : null}
              {detail.note && (
                <p className="mt-2 rounded-control bg-surface-sunken px-2.5 py-2 text-xs text-ink-body">{detail.note}</p>
              )}
            </div>

            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-body">Parent/caregiver signature</p>
              <div className="relative w-full overflow-hidden rounded-control border border-border bg-white">
                <div className="flex h-[140px] w-full items-center justify-center">
                  {detail.parent_signature && (
                    <img src={detail.parent_signature} alt="Parent signature" className="max-h-[85%] max-w-[90%] object-contain" />
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-body">Practitioner signature</p>
              <div className="relative w-full overflow-hidden rounded-control border border-border bg-white">
                <div className="flex h-[140px] w-full items-center justify-center">
                  <img src={detail.practitioner_signature} alt="Practitioner signature" className="max-h-[85%] max-w-[90%] object-contain" />
                </div>
              </div>
            </div>

            <Button className="w-full" size="lg" loading={confirming} onClick={handleConfirm}>
              Confirm & Submit
            </Button>
          </div>
        )}
      </div>
    </PushScreen>
  );
}
