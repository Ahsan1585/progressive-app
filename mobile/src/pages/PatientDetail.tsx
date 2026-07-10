import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatSafeDate, formatTime12h } from "@/utils/time";
import { serviceTypeMap, locationCodeMap, statusCodeMap } from "@/constants/njeis";
import type { Assessment } from "@/types";

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { patients } = useAppData();
  const patient = patients.find((p) => p.id === id);

  const [assessments, setAssessments] = React.useState<Assessment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchAssessments = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Assessment[]>(`/api/patients/${id}/assessments`);
      setAssessments(res.data);
    } catch {
      // Includes the 403/not-owner edge case — generic message, no ownership detail leaked.
      setError("Something went wrong loading this patient.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    fetchAssessments();
  }, [fetchAssessments]);

  const title = patient ? `${patient.first_name} ${patient.last_name}` : "Patient";

  return (
    <PushScreen>
      <AppBar title={title} />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {patient && (
          <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
            <h2 className="text-[20px] font-semibold capitalize leading-[26px] text-ink">
              {patient.first_name}
              {patient.middle_name ? ` ${patient.middle_name}` : ""} {patient.last_name}
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Child ID</p>
                <p className="tabular text-sm font-medium text-ink">{patient.child_id}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Date of birth</p>
                <p className="text-sm font-medium text-ink">{formatSafeDate(patient.dob)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">County</p>
                <p className="text-sm font-medium capitalize text-ink">{patient.county || "N/A"}</p>
              </div>
            </div>
          </div>
        )}

        {/* Sticky "Log Intervention" primary action — always reachable without scrolling. */}
        <div className="sticky top-0 z-10 -mx-4 mb-4 bg-bg px-4 pb-3 pt-1">
          <Button className="w-full" size="lg" onClick={() => navigate(`/patients/${id}/log`)}>
            <Plus className="size-4" aria-hidden="true" />
            Log intervention
          </Button>
        </div>

        <h3 className="mb-2 text-[15px] font-semibold text-ink">Encounter history</h3>

        {error ? (
          <EmptyState
            icon={ClipboardList}
            heading="Something went wrong loading this patient"
            action={
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={fetchAssessments}>
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate("/roster")}>
                  Back to roster
                </Button>
              </div>
            }
          />
        ) : loading ? (
          <ul className="space-y-2" aria-label="Loading encounter history">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-20 w-full" />
              </li>
            ))}
          </ul>
        ) : assessments.length === 0 ? (
          <EmptyState icon={ClipboardList} heading={`No visits logged yet for ${patient?.first_name ?? "this patient"}`} />
        ) : (
          <ul role="list" aria-label="Encounter history" className="space-y-2">
            {assessments.map((item) => (
              <li key={item.id} className="rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="tabular text-sm font-semibold text-ink">{formatSafeDate(item.service_date)}</p>
                    <p className="mt-0.5 text-sm text-ink-body">{serviceTypeMap[item.type] || item.type}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{locationCodeMap[item.location] || item.location}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge status={item.billing_status} />
                    <p className="tabular text-sm font-semibold text-ink">{(item.total_time / 60).toFixed(2)} hrs</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                  <span className="tabular">
                    {formatTime12h(item.start_time)} - {formatTime12h(item.end_time)}
                  </span>
                  <span className="font-semibold uppercase tracking-wide">{statusCodeMap[item.status] || item.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PushScreen>
  );
}
