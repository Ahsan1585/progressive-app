import type { CSSProperties, ReactNode } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import izayaLogo from "@/assets/izaya-logo.png";

// Scoped override of the app's tokens for the pre-auth stack: Izaya teal
// instead of the app-wide Clinical Trust Blue for the --primary family, and
// the rest pinned to their light-mode values (copied from :root in
// index.css). The app's dark mode (useSystemColorScheme, real & designed
// per art-direction §3) is intentional everywhere else — but this card's
// chrome (bg-white, text-slate-*, etc. below) is hardcoded light-only, so
// without this the Input/Field/Button internals would still pick up dark
// tokens from a system-level .dark class and render illegibly against it.
const authThemeVars = {
  // Surfaces
  "--bg": "#f8fafc",
  "--surface": "#ffffff",
  "--surface-sunken": "#f1f5f9",
  "--border": "#e2e8f0",
  "--border-strong": "#cbd5e1",

  // Ink
  "--ink": "#0f172a",
  "--ink-body": "#334155",
  "--ink-muted": "#64748b",
  "--ink-faint": "#94a3b8",

  // Accent — Izaya teal instead of the app-wide Clinical Trust Blue
  "--primary": "#0e7490",
  "--primary-hover": "#155e75",
  "--primary-tint": "#ecfeff",
  "--primary-tint-2": "#cffafe",
  "--primary-fg": "#ffffff",
  "--ring": "#0e7490",

  // Status semantics (error/success/info banners elsewhere in the auth stack)
  "--success": "#047857",
  "--success-bg": "#ecfdf5",
  "--success-border": "#a7f3d0",
  "--warning": "#b45309",
  "--warning-bg": "#fffbeb",
  "--warning-border": "#fde68a",
  "--danger": "#b91c1c",
  "--danger-bg": "#fef2f2",
  "--danger-border": "#fecaca",
  "--info": "#1d4ed8",
  "--info-bg": "#eff6ff",
  "--info-border": "#bfdbfe",
  "--override": "#6d28d9",
  "--override-bg": "#f5f3ff",
  "--override-border": "#ddd6fe",

  // Elevation
  "--elev-rest": "0 1px 2px 0 rgb(37 99 235 / 0.06), 0 1px 3px 0 rgb(37 99 235 / 0.04)",
  "--elev-raised": "0 2px 6px 0 rgb(37 99 235 / 0.08), 0 4px 10px -2px rgb(37 99 235 / 0.06)",
  "--elev-overlay": "0 8px 24px -4px rgb(37 99 235 / 0.14), 0 4px 8px -2px rgb(37 99 235 / 0.08)",

  colorScheme: "light",
} as CSSProperties;

// Pre-auth stack (Login / Forced Change / Forgot / Reset / Unsupported Role).
// Izaya is the primary brand here — the client (e.g. Progressive Steps) is
// deliberately not shown until after login, where account/tenant config
// determines which client's branding to surface.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="safe-top safe-bottom flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-100 px-5 py-8"
      style={authThemeVars}
    >
      <div className="m-auto w-full max-w-sm">
        <div className="overflow-hidden rounded-card border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.12)]">
          <div className="h-1 bg-gradient-to-r from-cyan-600 to-teal-500" />
          <div className="p-6">
            <div className="mb-8 flex flex-col items-center text-center">
              <img src={izayaLogo} alt="Izaya" className="mb-3 h-8 w-auto" />
              <p className="text-[11px] font-medium tracking-[0.14em] text-slate-500 uppercase">
                Early Intervention Simplified
              </p>
            </div>
            {children}
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center gap-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/60 px-3 py-1.5 backdrop-blur-sm">
            <Lock className="size-3 text-slate-600" aria-hidden="true" />
            <span className="text-[11px] font-medium tracking-[0.14em] text-slate-600 uppercase">
              Secured by Izaya
            </span>
            <span className="text-slate-600" aria-hidden="true">
              &middot;
            </span>
            <ShieldCheck className="size-3 text-slate-600" aria-hidden="true" />
            <span className="text-[11px] font-medium tracking-[0.14em] text-slate-600 uppercase">
              HIPAA Compliant
            </span>
          </div>
          <p className="text-[11px] text-slate-600">Izaya Consulting LLC</p>
        </div>
      </div>
    </div>
  );
}
