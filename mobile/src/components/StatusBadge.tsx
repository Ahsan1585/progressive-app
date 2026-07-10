import { Flag, Ban, Clock, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { billingStatusConfig } from "@/constants/njeis";
import type { BillingStatus } from "@/types";

const ICONS: Record<string, typeof Flag> = {
  rejected: Flag,
  declined: Ban,
  njeis_review: Clock,
  invoiced: CheckCircle2,
  pending: Circle,
};

const VARIANT_CLASSES: Record<string, string> = {
  neutral: "bg-surface-sunken text-ink-muted border-border",
  success: "bg-success-bg text-success border-success-border",
  warning: "bg-warning-bg text-warning border-warning-border",
  danger: "bg-danger-bg text-danger border-danger-border",
  info: "bg-info-bg text-info border-info-border",
  override: "bg-override-bg text-override border-override-border",
};

// Billing status indicator — always paired text label + icon, never
// color-only (a11y notes + art-direction §7.5).
export function StatusBadge({ status, className }: { status: BillingStatus | string; className?: string }) {
  const config = billingStatusConfig[status] ?? { label: status, variant: "neutral" as const };
  const Icon = ICONS[status] ?? Circle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold",
        VARIANT_CLASSES[config.variant],
        className
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {config.label}
    </span>
  );
}
