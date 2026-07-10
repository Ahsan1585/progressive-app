import type { ReactNode } from "react";

// Pre-auth stack (Login / Forced Change / Forgot / Reset / Unsupported Role)
// renders with no tab bar — single centered column, generous vertical rhythm.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="safe-top safe-bottom flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg px-6 py-10">
      <div className="m-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-card bg-primary text-primary-fg shadow-[var(--elev-raised)]">
            <span className="text-xl font-bold tracking-tight">PS</span>
          </div>
          <p className="text-sm font-medium text-ink-muted">Progressive Steps NJ · Practitioner</p>
        </div>
        {children}
      </div>
    </div>
  );
}
