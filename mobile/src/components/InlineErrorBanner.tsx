import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InlineErrorBannerProps {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

// Reused anywhere a fetch can fail without blocking the whole screen.
export function InlineErrorBanner({ message, onRetry, retrying, className }: InlineErrorBannerProps) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-card border border-danger-border bg-danger-bg p-4 ${className ?? ""}`}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div className="flex-1 space-y-2">
        <p className="text-sm font-medium text-danger">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} loading={retrying}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
