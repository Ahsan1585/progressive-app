import { Lock, ShieldCheck } from 'lucide-react';
// TODO: swap for the real Izaya logo once it's saved to frontend/src/assets/
// (this placeholder wordmark approximates it so the build isn't broken in the meantime).
import izayaLogo from '@/assets/izaya-logo.svg';

// Shared chrome for all public/post-login auth screens (Login, ForgotPassword,
// ResetPassword, ChangePassword) — keeps the brand header, card, and trust
// badge in one place. This is also the seam where per-client branding would
// get swapped in later, once accounts carry a client/tenant configuration.
export function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 p-4">
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.12)] animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        <div className="h-1 bg-gradient-to-r from-cyan-600 to-teal-500" />
        <div className="p-8">
          <div className="flex flex-col items-center justify-center mb-8 text-center">
            <img src={izayaLogo} alt="Izaya" className="h-9 w-auto mb-3" />
            <p className="text-[11px] font-medium tracking-[0.14em] text-slate-500 uppercase">
              Early Intervention Management System
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
          <span className="text-slate-600" aria-hidden="true">&middot;</span>
          <ShieldCheck className="size-3 text-slate-600" aria-hidden="true" />
          <span className="text-[11px] font-medium tracking-[0.14em] text-slate-600 uppercase">
            HIPAA Compliant
          </span>
        </div>
        <p className="text-[11px] text-slate-600">Izaya Consulting LLC</p>
      </div>
    </div>
  );
}
