import { Lock, ShieldCheck, Smartphone, Download } from 'lucide-react';
import izayaLogo from '@/assets/izaya-logo.png';

// The practitioner mobile app is a separate deployment (its own PWA install
// flow lives there — Android gets a native install prompt, iOS gets "Add to
// Home Screen" instructions — neither can be triggered from this origin).
const MOBILE_APP_URL = 'https://mobile-pied-two.vercel.app/login';
// `install=1` tells the mobile login page to lead with the install
// card instead of burying it below the sign-in form.
const MOBILE_APP_INSTALL_URL = `${MOBILE_APP_URL}?install=1`;

// Decorative hero banner (mobile layout only) — early-intervention motif
// (sprout growth + a parent/child pair holding hands) on the Izaya
// teal/sky/mint gradient. Purely illustrative; hidden from assistive tech.
function LoginHero() {
  return (
    <svg
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="loginHeroGlowWeb" cx="82%" cy="18%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="160" fill="url(#loginHeroGlowWeb)" />
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

// Shared chrome for all public/post-login auth screens (Login, ForgotPassword,
// ResetPassword, ChangePassword) — keeps the brand header, card, and trust
// badge in one place. This is also the seam where per-client branding would
// get swapped in later, once accounts carry a client/tenant configuration.
//
// Renders two layouts in the DOM and lets a CSS breakpoint (md, 768px —
// matching the app's existing mobile breakpoint) pick the visible one, so it
// adapts instantly on resize/rotate with no JS device-sniffing. The `md:`
// half below is the pre-existing desktop design (kept as-is until a separate
// desktop redesign is provided); the rest is the mobile-first layout.
export function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-white md:items-center md:justify-center md:bg-slate-100 md:p-4">
      <div className="flex flex-1 flex-col md:flex-none md:w-full md:max-w-[420px]">
        {/* Hero banner — mobile only, flush to the screen edges */}
        <div className="md:hidden relative h-44 shrink-0 overflow-hidden bg-gradient-to-br from-[#0E6E67] via-[#2E8FC7] to-[#2FBF9F]">
          <LoginHero />
        </div>

        <div className="relative overflow-hidden md:rounded-2xl border-0 md:border md:border-slate-200/80 bg-white md:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.12)] animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="hidden md:block h-1 bg-gradient-to-r from-cyan-600 to-teal-500" />
          <div className="px-6 pt-8 pb-6 md:p-8">
            <div className="flex flex-col items-center justify-center mb-6 md:mb-8 text-center">
              <img src={izayaLogo} alt="Izaya" className="h-9 w-auto mb-3" />
              <p className="text-[11px] font-medium tracking-[0.14em] text-slate-500 uppercase">
                Early Intervention Simplified
              </p>
            </div>

            {/* Trust bar — mobile only, inline in the card */}
            <div className="md:hidden mb-6 flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              Secured &amp; HIPAA Compliant
            </div>

            {children}
          </div>
        </div>

        {/* Mobile: single combined install badge — flush width, fills the rest of the screen so no page background shows around it */}
        <div className="md:hidden flex flex-1 flex-col items-center justify-center gap-2.5 bg-slate-50 px-6 py-8">
          <a
            href={MOBILE_APP_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 rounded-xl bg-[#132A3E] px-4.5 py-2.5 text-white transition-colors hover:brightness-110"
          >
            <Download className="size-[18px] shrink-0" aria-hidden="true" />
            <span className="flex flex-col text-left leading-tight">
              <span className="text-[9px] font-medium uppercase tracking-wide opacity-75">No app store needed</span>
              <span className="text-[13px] font-semibold">Install App on Your Phone</span>
            </span>
          </a>
          <p className="text-[11px] text-slate-500">Works on iPhone &amp; Android — installs in seconds</p>
          <p className="text-[11px] text-slate-600">Izaya Consulting LLC</p>
        </div>
      </div>

      {/* Desktop trust badge + per-platform install links */}
      <div className="hidden md:flex mt-6 flex-col items-center gap-1">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/60 px-3 py-1.5 backdrop-blur-sm">
          <Lock className="size-3 text-slate-600" aria-hidden="true" />
          <span className="text-[11px] font-medium tracking-[0.14em] text-slate-600 uppercase">
            Secured by Izaya
          </span>
          <span className="text-slate-600" aria-hidden="true">&middot;</span>
          <ShieldCheck className="size-3 text-slate-600" aria-hidden="true" />
          <span className="text-[11px] font-medium tracking-[0.14em] text-slate-600 uppercase">
            HIPAA Compliant
          </span>
        </div>
        <p className="text-[11px] text-slate-600">Izaya Consulting LLC</p>

        <div className="mt-4 flex items-center gap-3">
          <a
            href={MOBILE_APP_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/60 px-3 py-1.5 text-[11px] font-medium text-slate-600 backdrop-blur-sm transition-colors hover:border-cyan-600/40 hover:text-cyan-700"
          >
            <Smartphone className="size-3.5" aria-hidden="true" />
            Get it on Android
          </a>
          <a
            href={MOBILE_APP_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/60 px-3 py-1.5 text-[11px] font-medium text-slate-600 backdrop-blur-sm transition-colors hover:border-cyan-600/40 hover:text-cyan-700"
          >
            <Smartphone className="size-3.5" aria-hidden="true" />
            Get it on iPhone
          </a>
        </div>
      </div>
    </div>
  );
}
