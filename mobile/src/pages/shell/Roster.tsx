import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Users, X } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { filterPatients } from "@/utils/roster";

type StatusFilter = "all" | "active" | "inactive";

export default function Roster() {
  const { patients, patientsLoading, patientsError, fetchPatients } = useAppData();
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const navigate = useNavigate();

  const byStatus = statusFilter === "all" ? patients : patients.filter((p) => (p.status || "active") === statusFilter);
  const filtered = filterPatients(byStatus, query);

  // Refetch every time the practitioner lands on Roster (route components
  // fully remount on navigation) — replaces the native pull-to-refresh
  // gesture disabled by the page-pinning bounce fix.
  React.useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  return (
    <div className="safe-top flex flex-1 flex-col">
      <div className="sticky top-0 z-10 space-y-3 border-b border-border bg-bg px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[20px] font-semibold leading-[26px] text-ink">Roster</h1>
          <button
            type="button"
            onClick={() => navigate("/patients/new")}
            aria-label="Add patient"
            className="press-scale flex size-11 items-center justify-center rounded-control border border-border-strong bg-surface text-ink"
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or Child ID"
            aria-label="Search patients"
            className="h-11 w-full rounded-control border border-border bg-surface pl-9 pr-9 text-base text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/45"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Filter by status">
          {(["all", "active", "inactive"] as StatusFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={
                "flex-1 rounded-control border px-2.5 py-1.5 text-xs font-semibold capitalize " +
                (statusFilter === key
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-surface text-ink-muted")
              }
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 py-3">
        {patientsError ? (
          <InlineErrorBanner message={patientsError} onRetry={fetchPatients} />
        ) : patientsLoading ? (
          <ul className="space-y-2" aria-label="Loading patients">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <Skeleton className="h-[68px] w-full" />
              </li>
            ))}
          </ul>
        ) : patients.length === 0 ? (
          <EmptyState
            icon={Users}
            heading="No patients yet"
            subtext="Add your first patient to start logging visits."
            action={
              <button
                type="button"
                onClick={() => navigate("/patients/new")}
                className="press-scale inline-flex h-11 items-center gap-1.5 rounded-control bg-primary px-4 text-sm font-medium text-primary-fg"
              >
                <Plus className="size-4" aria-hidden="true" />
                Add patient
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            heading={`No patients match "${query}"`}
            action={
              <button type="button" onClick={() => setQuery("")} className="text-sm font-medium text-primary">
                Clear search
              </button>
            }
          />
        ) : (
          <ul role="list" aria-label="Patients" className="space-y-2">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/patients/${p.id}`)}
                  className="press-scale flex w-full items-center justify-between rounded-card border border-border bg-surface p-3.5 text-left shadow-[var(--elev-rest)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold capitalize text-ink">
                      {p.first_name}
                      {p.middle_name ? ` ${p.middle_name}` : ""} {p.last_name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <p className="tabular text-xs text-ink-muted">ID: {p.child_id}</p>
                      {p.status === "inactive" && (
                        <span className="rounded-full border border-border-strong bg-surface-sunken px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
