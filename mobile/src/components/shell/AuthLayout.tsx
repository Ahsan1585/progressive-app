import type { CSSProperties, ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
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

// Decorative hero banner — early-intervention motif (sprout growth + a
// parent/child pair holding hands) on the Izaya teal/sky/mint gradient.
// Purely illustrative; hidden from assistive tech.
function LoginHero() {
  return (
    <svg
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="loginHeroGlow" cx="82%" cy="18%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="160" fill="url(#loginHeroGlow)" />
      <path d="M0 120 Q60 92 130 115 T260 110 T400 120 V160 H0 Z" fill="#ffffff" opacity="0.10" />
      <path d="M0 136 Q80 112 170 132 T400 130 V160 H0 Z" fill="#ffffff" opacity="0.14" />
      <g transform="translate(298,84)" opacity="0.9">
        <path d="M0 44 V14" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
        <path d="M0 30 C -14 26 -16 12 -8 4 C -2 14 0 22 0 30 Z" fill="#ffffff" opacity="0.85" />
        <path d="M0 22 C 14 18 16 6 9 -2 C 3 8 0 15 0 22 Z" fill="#ffffff" opacity="0.85" />
      </g>
      <g transform="translate(110,126)">
        <circle cx="0" cy="-40" r="11" fill="#ffffff" />
        <path d="M-13 -6 C-13 -22 -12 -30 0 -30 C12 -30 13 -22 13 -6 L13 6 L-13 6 Z" fill="#ffffff" />
        <circle cx="34" cy="-24" r="8" fill="#ffffff" opacity="0.95" />
        <path d="M22 -2 C22 -13 23 -18 34 -18 C45 -18 46 -13 46 -2 L46 6 L22 6 Z" fill="#ffffff" opacity="0.95" />
        <path d="M13 -10 Q23 -6 22 -3" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      <circle cx="60" cy="36" r="3" fill="#ffffff" opacity="0.5" />
      <circle cx="340" cy="40" r="2.4" fill="#ffffff" opacity="0.45" />
      <circle cx="200" cy="24" r="2" fill="#ffffff" opacity="0.4" />
    </svg>
  );
}

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
        <div className="relative -mb-3.5 h-[104px] overflow-hidden rounded-t-[22px] rounded-b-md bg-gradient-to-br from-[#0E6E67] via-[#2E8FC7] to-[#2FBF9F]">
          <LoginHero />
        </div>

        <div className="relative overflow-hidden rounded-t-md rounded-b-[22px] border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.12)]">
          <div className="p-6">
            <div className="mb-4 flex flex-col items-center text-center">
              <img src={izayaLogo} alt="Izaya" className="mb-3 h-8 w-auto" />
              <p className="text-[11px] font-medium tracking-[0.14em] text-slate-500 uppercase">
                Early Intervention Simplified
              </p>
            </div>

            <div className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              Secured &amp; HIPAA Compliant
            </div>

            {children}
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-600">Izaya Consulting LLC</p>
      </div>
    </div>
  );
}
