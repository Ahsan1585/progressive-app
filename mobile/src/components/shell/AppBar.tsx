import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface AppBarProps {
  title: string;
  onBack?: () => void;
  /** Set false for screens that must not be escapable (Forced Password Change). */
  showBack?: boolean;
  trailing?: ReactNode;
  className?: string;
}

// Top app bar for full-screen pushed views (Add Patient, Patient Detail, Log
// Intervention, Resubmit) — back chevron >= 44px, centered/leading title.
export function AppBar({ title, onBack, showBack = true, trailing, className }: AppBarProps) {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        "safe-top sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-2 shadow-[var(--elev-rest)]",
        className
      )}
    >
      {showBack ? (
        <button
          type="button"
          onClick={onBack ?? (() => navigate(-1))}
          aria-label="Back"
          className="press-scale flex size-11 shrink-0 items-center justify-center rounded-control text-ink hover:bg-surface-sunken"
        >
          <ChevronLeft className="size-6" aria-hidden="true" />
        </button>
      ) : (
        <div className="w-11 shrink-0" aria-hidden="true" />
      )}
      <h1 className="flex-1 truncate text-[17px] font-semibold text-ink">{title}</h1>
      {trailing ? <div className="shrink-0">{trailing}</div> : <div className="w-11 shrink-0" aria-hidden="true" />}
    </header>
  );
}
