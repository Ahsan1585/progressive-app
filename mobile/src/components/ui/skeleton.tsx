import { cn } from "@/lib/utils";

// Structurally distinct from a "0" value (never confuse "still loading" with
// a legitimate empty/zero state) — reused for Home stat tiles, Roster rows,
// Patient Detail history rows, Inbox rows.
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn("animate-pulse rounded-control bg-surface-sunken", className)}
    />
  );
}
