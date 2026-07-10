import * as React from "react";
import { cn } from "@/lib/utils";

// 48px tall — comfortably above the 44px a11y minimum, roomy for on-screen
// keyboards. Font stays >= 16px (art-direction type scale) to avoid iOS
// auto-zoom on focus.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-12 w-full min-w-0 rounded-control border border-border bg-surface px-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/20",
        className
      )}
      {...props}
    />
  );
}

export { Input };
