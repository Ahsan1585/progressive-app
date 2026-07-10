import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Full-screen pushed views slide in from the right on entry (art-direction
// §6). True direction-aware exit transitions need a route-transition library
// this app doesn't otherwise depend on; the entrance slide is what's
// perceptible in the common "drill in" flow, so the exit is a plain
// (reduced-motion-safe) unmount rather than an animated slide-out.
export function PushScreen({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("push-panel flex min-h-0 flex-1 flex-col bg-bg", className)}>{children}</div>;
}
