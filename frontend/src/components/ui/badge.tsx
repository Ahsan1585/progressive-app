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
        hold: "border-orange-200 bg-orange-100 text-orange-700",
        // Decorative, non-semantic palette for hash-based coloring (e.g. a
        // specific custom role name, not a fixed status) — pick one of
        // these by hashing a string into the set, not by what the badge
        // means. See RegisterPractitionerForm.jsx's roleBadgeVariant.
        "role-purple": "border-purple-200 bg-purple-100 text-purple-700",
        "role-teal": "border-teal-200 bg-teal-100 text-teal-700",
        "role-amber": "border-amber-200 bg-amber-100 text-amber-700",
        "role-rose": "border-rose-200 bg-rose-100 text-rose-700",
        "role-cyan": "border-cyan-200 bg-cyan-100 text-cyan-700",
        "role-indigo": "border-indigo-200 bg-indigo-100 text-indigo-700",
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
