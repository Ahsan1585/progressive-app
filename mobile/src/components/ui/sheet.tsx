import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// Bottom sheet — used for Acknowledge Decline (design: "reusable for any
// other lightweight single-action flow later"). Slides in from the bottom
// edge (art-direction §6), swipe-to-dismiss with momentum (velocity > 0.11
// dismisses, per emil-design-eng), rounded top corners only (16px), grabber
// handle.

const SheetContext = React.createContext<{ onOpenChange?: (open: boolean) => void }>({});

function Sheet({
  children,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <SheetContext.Provider value={{ onOpenChange }}>
      <DialogPrimitive.Root data-slot="sheet" onOpenChange={onOpenChange} {...props}>
        {children}
      </DialogPrimitive.Root>
    </SheetContext.Provider>
  );
}

function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

const SWIPE_DISMISS_DISTANCE = 90; // px
const SWIPE_DISMISS_VELOCITY = 0.11; // px/ms

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const { onOpenChange } = React.useContext(SheetContext);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const dragState = React.useRef<{ startY: number; startTime: number; dragging: boolean } | null>(null);
  const [dragY, setDragY] = React.useState(0);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startY: e.clientY, startTime: Date.now(), dragging: true };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current?.dragging) return;
    const delta = e.clientY - dragState.current.startY;
    // Friction instead of a hard stop when dragging upward past the origin.
    setDragY(delta > 0 ? delta : delta * 0.15);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragState.current?.dragging) return;
    const delta = e.clientY - dragState.current.startY;
    const elapsed = Math.max(1, Date.now() - dragState.current.startTime);
    const velocity = Math.abs(delta) / elapsed;
    dragState.current.dragging = false;

    if (delta > SWIPE_DISMISS_DISTANCE || (delta > 0 && velocity > SWIPE_DISMISS_VELOCITY)) {
      onOpenChange?.(false);
    }
    setDragY(0);
  };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="sheet-overlay" className="overlay-scrim fixed inset-0 z-50 bg-ink/40" />
      <DialogPrimitive.Content
        ref={contentRef}
        data-slot="sheet-content"
        className={cn(
          "sheet-panel fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-sheet border-t border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink shadow-[var(--elev-overlay)] outline-none",
          className
        )}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
        {...props}
      >
        <div
          className="-mt-1.5 mb-3 flex touch-none justify-center py-2"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="h-1.5 w-10 rounded-full bg-border-strong" aria-hidden="true" />
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("mb-4 space-y-1", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-[17px] font-semibold leading-6 text-ink", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-ink-muted", className)}
      {...props}
    />
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
