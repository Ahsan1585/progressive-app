import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedNumber } from "@/components/AnimatedNumber";

interface StatTileProps {
  label: string;
  value: number | null;
  loading: boolean;
  formatter?: (n: number) => string;
}

// Hero-number stat tile — no chart needed for a single KPI (dataviz skill:
// choosing-a-form). Text wears text tokens, value in tabular Geist Mono.
export function StatTile({ label, value, loading, formatter }: StatTileProps) {
  return (
    <div className="rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]">
      {loading || value === null ? (
        <Skeleton className="h-7 w-12" />
      ) : (
        <div className="text-[22px] font-semibold leading-7 text-ink">
          <AnimatedNumber value={value} formatter={formatter} />
        </div>
      )}
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}
