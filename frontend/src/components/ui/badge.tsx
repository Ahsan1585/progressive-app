import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold [&_svg]:pointer-events-none [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-slate-200 bg-slate-100 text-slate-500",
        success: "border-emerald-200 bg-emerald-100 text-emerald-700",
        warning: "border-amber-200 bg-amber-100 text-amber-700",
        danger: "border-red-200 bg-red-100 text-red-700",
        info: "border-blue-200 bg-blue-100 text-blue-700",
        override: "border-violet-200 bg-violet-100 text-violet-700",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
