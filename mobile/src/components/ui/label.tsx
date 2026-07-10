import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// Persistent, visible, sentence-case labels above every field — never
// placeholder-as-label (a11y notes + anti-slop guardrails).
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("mb-1.5 block text-[13px] font-medium leading-[18px] text-ink-body", className)}
      {...props}
    />
  );
}

export { Label };
