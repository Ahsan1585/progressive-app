import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  heading: string;
  subtext?: string;
  action?: ReactNode;
  className?: string;
}

// Reused (with different copy) on Roster, Patient Detail history, and Inbox.
export function EmptyState({ icon: Icon, heading, subtext, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-tint">
        <Icon className="size-7 text-primary" />
      </div>
      <h3 className="text-balance text-[17px] font-semibold text-ink">{heading}</h3>
      {subtext && <p className="mt-1.5 max-w-xs text-sm text-ink-muted">{subtext}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
