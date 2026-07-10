import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

// Every pressable surface gets the same 120ms scale(0.97) press feedback
// (art-direction §6, emil-design-eng review) — the single biggest tactile
// upgrade over the desktop site. Touch targets stay >= 44px (a11y notes).
const buttonVariants = cva(
  "press-scale inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-control border text-[15px] font-medium outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-primary text-primary-fg hover:bg-primary-hover",
        outline: "border-border-strong bg-surface text-ink hover:bg-surface-sunken",
        ghost: "border-transparent bg-transparent text-ink hover:bg-surface-sunken",
        destructive: "border-transparent bg-danger text-white hover:brightness-110",
        subtle: "border-transparent bg-primary-tint text-primary hover:bg-primary-tint-2",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-9 px-3 text-sm",
        lg: "h-12 px-5 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
