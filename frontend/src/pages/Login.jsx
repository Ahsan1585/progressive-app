import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import QRCode from 'qrcode';
import api from '@/api/axiosInstance';
import { PasswordInput } from '@/components/ui/password-input';
import { MOBILE_APP_INSTALL_URL } from '@/components/AuthLayout';
// Self-hosted (not the Google Fonts CDN) — this app's CSP is script/style
// 'self'-only, so an external fonts.googleapis.com <link> silently fails to
// load and every "Fraunces" heading was falling back to the browser's
// default serif. Bundled here instead, same pattern as Geist elsewhere in the app.
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

const QR_HOST = new URL(MOBILE_APP_INSTALL_URL).host;

// The IZAYA wordmark as paths (chevron, I, Z, two A's, Y) — reused across the
// nav, footer, and anywhere else the brand mark needs to render crisply at
// any size without shipping a raster asset.
function IzayaWordmark({ className }) {
  return (
    <svg className={className} viewBox="0 0 460 130" role="img" aria-label="IZAYA">
      <path className="ilg-m" d="M22 32 L60 63 L22 94" />
      <path className="ilg-n" d="M96 28 L96 98" />
      <path className="ilg-n" d="M130 28 L196 28" />
      <path className="ilg-m" d="M196 28 L130 98" />
      <path className="ilg-n" d="M130 98 L196 98" />
      <path className="ilg-n" d="M216 98 L248 28 L280 98" />
      <path className="ilg-n" d="M230 74 L266 74" />
      <path className="ilg-n" d="M300 28 L332 64" />
      <path className="ilg-n" d="M364 28 L332 64" />
      <path className="ilg-n" d="M332 64 L332 98" />
      <path className="ilg-n" d="M384 98 L416 28 L448 98" />
      <path className="ilg-n" d="M398 74 L434 74" />
      <circle className="ilg-node" cx="248" cy="28" r="13" />
      <circle className="ilg-node" cx="332" cy="64" r="13" />
      <circle className="ilg-node" cx="416" cy="28" r="13" />
    </svg>
  );
}

function HorizonIllustration() {
  return (
    <div className="il-horizon" aria-hidden="true">
      <svg viewBox="0 0 1440 220" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="ilHillA" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0E6E67" /><stop offset="60%" stopColor="#2E8FC7" /><stop offset="100%" stopColor="#2FBF9F" />
          </linearGradient>
        </defs>
        <path d="M0 150 Q 220 96 460 132 T 900 122 T 1440 138 V220 H0 Z" fill="url(#ilHillA)" opacity="0.16" />
        <path d="M0 178 Q 260 128 560 162 T 1080 152 T 1440 168 V220 H0 Z" fill="url(#ilHillA)" opacity="0.3" />
        <path d="M0 202 Q 300 168 640 192 T 1440 194 V220 H0 Z" fill="url(#ilHillA)" opacity="0.55" />
        <g transform="translate(610,196)">
          <circle cx="0" cy="-42" r="11" fill="#0E6E67" />
          <path d="M-13 -7 C-13 -23 -12 -31 0 -31 C12 -31 13 -23 13 -7 L13 4 L-13 4 Z" fill="#0E6E67" />
          <circle cx="33" cy="-26" r="8" fill="#0E6E67" opacity="0.85" />
          <path d="M21 -3 C21 -14 22 -19 33 -19 C44 -19 45 -14 45 -3 L45 4 L21 4 Z" fill="#0E6E67" opacity="0.85" />
          <path d="M13 -11 Q22 -7 21 -4" stroke="#0E6E67" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
        <g transform="translate(830,160)" opacity="0.9">
          <path d="M0 40 V12" stroke="#0E6E67" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M0 26 C -13 22 -15 9 -7 2 C -2 12 0 19 0 26 Z" fill="#0E6E67" />
          <path d="M0 19 C 13 15 15 4 8 -4 C 3 6 0 13 0 19 Z" fill="#0E6E67" />
        </g>
        <circle cx="560" cy="168" r="5" fill="#2FBF9F" />
        <circle cx="680" cy="158" r="5" fill="#2FBF9F" />
        <circle cx="780" cy="152" r="5" fill="#2FBF9F" />
        <circle cx="900" cy="156" r="5" fill="#2FBF9F" />
      </svg>
    </div>
  );
}

const CHECK_ICON = <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>;
const PIN_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>;

// The five steps a session log actually walks through end to end — a real
// sequence, so numbering/order here is meaningful (unlike the feature grid
// below, which lists independent capabilities and stays unnumbered).
const PIPELINE_STEPS = [
  { label: 'Log Submitted', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg> },
  { label: 'Matched to EIMS Records', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12l3 3 6-7" /></svg> },
  { label: 'Auto-Approved', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12l5 5L20 6" /></svg> },
  { label: 'Form Auto-Filled', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg> },
  { label: 'Invoice Generated', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg> },
];

// Independent capabilities — order carries no meaning, so no numbering.
const FEATURES = [
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="#0E6E67" strokeWidth="1.9"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>,
    bg: 'rgba(47,191,159,0.13)',
    title: 'Auto-Approval on Match',
    body: 'Matches EIMS records instantly. Only mismatches reach a human.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="#2E8FC7" strokeWidth="1.9"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M9 16l2 2 4-4" /></svg>,
    bg: 'rgba(46,143,199,0.12)',
    title: 'Parent Calendar Sync',
    body: 'Reschedule updates the invite — never duplicates it.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="#7C5CE0" strokeWidth="1.9"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>,
    bg: 'rgba(124,92,224,0.1)',
    title: 'Every PHI Touch, Logged',
    body: 'Who, what, when — visible to admins, always on.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="#0E6E67" strokeWidth="1.9"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
    bg: 'rgba(47,191,159,0.13)',
    title: 'Staff Messaging, Built In',
    body: 'Coordination stays in the record, not a text thread.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="#2E8FC7" strokeWidth="1.9"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
    bg: 'rgba(46,143,199,0.12)',
    title: 'Signed URLs, Never Public',
    body: 'Every document link expires. Nothing sits exposed.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="#7C5CE0" strokeWidth="1.9"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
    bg: 'rgba(124,92,224,0.1)',
    title: 'Two Portals, One Record',
    body: 'Practitioners and admins see exactly what they need.',
  },
];

const COMPLIANCE_BADGES = [
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>, title: 'Audit Logged', sub: '§164.312(b)' },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>, title: 'Signed URLs', sub: "Links expire, files don't leak" },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>, title: 'Point-of-Care Signature', sub: 'Captured, not reconstructed' },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>, title: 'Role-Scoped', sub: 'By design, not by luck' },
];

function DownloadQR() {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, MOBILE_APP_INSTALL_URL, {
      width: 184,
      margin: 1,
      color: { dark: '#132A3E', light: '#ffffff' },
    }).catch(() => setFailed(true));
  }, []);

  return (
    <div className="il-qr-tile">
      <div className="il-qr" aria-label={`QR code linking to ${QR_HOST}`}>
        {failed ? (
          <span style={{ fontSize: 12, color: '#5C6B73' }}>Visit<br /><b>{QR_HOST}</b><br />on your phone</span>
        ) : (
          <canvas ref={canvasRef} width={184} height={184} />
        )}
      </div>
      <div className="il-qr-label">Scan to install</div>
      <div className="il-qr-sub">{QR_HOST}</div>
    </div>
  );
}

// Shown once to a first-time visitor arriving on a phone browser — the QR
// code further down the page is for someone on a *desktop* scanning it with
// their phone, which is useless if they're already reading this on the
// phone itself. This links straight to the installable app's own install
// page instead (this origin isn't itself a PWA, so there's no
// beforeinstallprompt to hook here).
const MOBILE_BANNER_SEEN_KEY = 'izaya-mobile-install-banner-seen';

const Login = () => {
  // Remembered from a previous successful login on this device — most
  // returning users never have to type it again after their first visit.
  const [companySlug, setCompanySlug] = useState(() => {
    try { return localStorage.getItem('companySlug') || ''; } catch { return ''; }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  // Lazy initializer (not an effect) — this is a one-time read of the
  // device/localStorage at mount, not a value that needs to stay in sync
  // with anything afterward.
  const [showMobileInstallBanner, setShowMobileInstallBanner] = useState(() => {
    try {
      const isPhoneViewport = window.matchMedia('(max-width: 767px)').matches;
      const alreadySeen = localStorage.getItem(MOBILE_BANNER_SEEN_KEY) === 'true';
      return isPhoneViewport && !alreadySeen;
    } catch {
      return false;
    }
  });
  const navigate = useNavigate();
  const location = useLocation();
  const resetSuccess = location.state?.resetSuccess;

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll-reveal for sections below the fold, mirroring the marketing
  // page's `.reveal` treatment without a dependency — each observed element
  // fades/lifts in once, then is left alone.
  useEffect(() => {
    const els = document.querySelectorAll('.il-reveal');
    if (!('IntersectionObserver' in window) || els.length === 0) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('il-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const dismissMobileInstallBanner = () => {
    setShowMobileInstallBanner(false);
    try { localStorage.setItem(MOBILE_BANNER_SEEN_KEY, 'true'); } catch { /* ignore */ }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const slug = companySlug.trim().toLowerCase();
      const response = await api.post('/api/auth/login', { slug, email, password });

      if (response.data.success) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('role', response.data.practitioner.role);
        localStorage.setItem('companySlug', slug);

        const role = response.data.practitioner.role;
        // Phase 2: every non-practitioner office account is 'ceo' or the catch-all 'staff'.
        const ADMIN_ROLES = ['ceo', 'staff'];

        if (response.data.requirePasswordChange) {
          navigate('/change-password');
        } else if (ADMIN_ROLES.includes(role)) {
          navigate('/admin-dashboard');
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please check your credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="izaya-landing">
      <style>{`
        .izaya-landing{
          --il-navy:#132A3E; --il-navy-deep:#0C1D2C; --il-teal:#0E6E67; --il-mint:#2FBF9F; --il-sky:#2E8FC7; --il-violet:#7C5CE0; --il-coral:#D65F4C;
          --il-paper:#F7FAF9; --il-card:#FFFFFF; --il-ink:#1B2B38; --il-slate:#5C6B73; --il-slate-light:#8FA0A8; --il-body:#3D4B54;
          --il-line:#E2EAE8; --il-focus-glow: 0 0 0 4px rgba(47,191,159,0.16); --il-ease: cubic-bezier(0.22, 1, 0.36, 1);
          font-family:'Inter Variable', sans-serif; color:var(--il-ink); background:var(--il-paper); overflow-x:hidden;
        }
        .izaya-landing *{ box-sizing:border-box; }
        .izaya-landing ::selection{ background:rgba(47,191,159,0.25); }

        .il-reveal{ opacity:0; transform:translateY(22px); transition: opacity 0.7s var(--il-ease), transform 0.7s var(--il-ease); }
        .il-reveal.il-in{ opacity:1; transform:translateY(0); }

        .il-nav{ position:fixed; top:0; left:0; right:0; z-index:50; display:flex; align-items:center; justify-content:space-between; padding:20px 48px; transition: background 0.3s ease, box-shadow 0.3s ease, padding 0.3s ease; }
        .il-nav.scrolled{ background:rgba(247,250,249,0.9); backdrop-filter:blur(14px); box-shadow:0 1px 0 rgba(19,42,62,0.06); padding:14px 48px; }
        .il-nav-brand{ display:flex; align-items:center; gap:14px; }
        .il-nav-logo{ width:118px; height:auto; display:block; }
        .il-nav-slogan{ font-size:11px; font-weight:600; letter-spacing:0.8px; text-transform:uppercase; color:var(--il-slate); padding-left:14px; border-left:1px solid var(--il-line); }
        .il-nav-right{ display:flex; align-items:center; gap:26px; }
        .il-nav-link{ font-size:13.5px; font-weight:500; color:var(--il-ink); opacity:0.75; text-decoration:none; transition:color 0.15s ease, opacity 0.15s ease; }
        .il-nav-link:hover{ color:var(--il-navy); opacity:1; }
        .il-nav-cta{ font-size:13.5px; font-weight:600; color:#fff; text-decoration:none; padding:9px 19px; background:var(--il-navy); border-radius:999px; transition: filter 0.15s ease; }
        .il-nav-cta:hover{ filter:brightness(1.15); }

        .izaya-landing .ilg-n{ stroke:var(--il-navy); fill:none; stroke-width:13; stroke-linecap:round; stroke-linejoin:round; }
        .izaya-landing .ilg-m{ stroke:var(--il-mint); fill:none; stroke-width:13; stroke-linecap:round; stroke-linejoin:round; }
        .izaya-landing .ilg-node{ fill:var(--il-mint); }

        /* ============ HERO ============ */
        .il-hero{ position:relative; padding:130px 48px 0; overflow:hidden; }
        .il-hero::before{ content:""; position:absolute; inset:0; background: radial-gradient(60% 50% at 82% 6%, rgba(46,143,199,0.11), transparent 60%), radial-gradient(50% 42% at 8% 12%, rgba(47,191,159,0.11), transparent 60%), linear-gradient(180deg, #EEF6F4 0%, var(--il-paper) 60%); pointer-events:none; z-index:0; }
        .il-hero-inner{ position:relative; z-index:2; max-width:1160px; margin:0 auto; display:grid; grid-template-columns:1fr 0.82fr; gap:56px; align-items:center; padding-bottom:60px; }

        .izaya-landing h1{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:clamp(38px, 4.4vw, 60px); line-height:1.08; letter-spacing:-0.8px; color:var(--il-navy); margin:0 0 16px; opacity:0; animation: ilUp 0.8s var(--il-ease) 0.16s forwards; }
        .izaya-landing h1 em{ font-style:normal; color:var(--il-teal); }
        .il-hero-badge{ display:inline-flex; align-items:center; gap:7px; font-size:11px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase; color:var(--il-sky); background:rgba(46,143,199,0.1); border:1px solid rgba(46,143,199,0.28); padding:7px 15px 7px 12px; border-radius:999px; margin-bottom:20px; opacity:0; animation: ilUp 0.8s var(--il-ease) 0.04s forwards; }
        .il-hero-badge svg{ width:12px; height:12px; stroke-linecap:round; stroke-linejoin:round; }
        .il-hero-sub{ font-size:16.5px; color:var(--il-body); margin-bottom:26px; line-height:1.55; max-width:480px; opacity:0; animation: ilUp 0.8s var(--il-ease) 0.28s forwards; }

        .il-hero-checklist{ display:flex; flex-direction:column; gap:13px; opacity:0; animation: ilUp 0.8s var(--il-ease) 0.4s forwards; }
        .il-hc-item{ display:flex; align-items:center; gap:12px; font-size:14px; font-weight:500; color:var(--il-ink); }
        .il-hc-check{ width:22px; height:22px; border-radius:50%; background:var(--il-mint); color:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .il-hc-check svg{ width:11px; height:11px; stroke:currentColor; stroke-width:3; fill:none; stroke-linecap:round; stroke-linejoin:round; }

        @keyframes ilUp{ from{ opacity:0; transform:translateY(18px); } to{ opacity:1; transform:translateY(0); } }

        .il-auth-wrap{ position:relative; opacity:0; animation: ilUp 0.9s var(--il-ease) 0.36s forwards; }
        .il-card{ position:relative; z-index:3; background:var(--il-card); border-radius:22px; padding:32px 32px 24px; box-shadow:0 1px 2px rgba(19,42,62,0.05), 0 28px 64px -18px rgba(19,42,62,0.25); max-width:400px; margin-left:auto; overflow:hidden; }
        .il-card::before{ content:""; position:absolute; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg, var(--il-mint), var(--il-teal) 55%, var(--il-sky) 85%, var(--il-navy)); }
        .il-card h2{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:22px; color:var(--il-navy); margin:0 0 5px; }
        .il-card-nj-tag{ display:inline-flex; align-items:center; gap:5px; font-size:10.5px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; color:var(--il-teal); margin-bottom:18px; }
        .il-card-nj-tag svg{ width:10px; height:10px; stroke-linecap:round; stroke-linejoin:round; }

        .il-field{ margin-bottom:14px; }
        .il-field label{ display:block; font-size:12.5px; font-weight:600; color:var(--il-navy); margin-bottom:6px; }
        .il-field-row{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; }
        .il-forgot{ font-size:12.5px; color:var(--il-teal); text-decoration:none; font-weight:600; }
        .il-forgot:hover{ text-decoration:underline; }
        .izaya-landing .il-card input[type="email"], .izaya-landing .il-card input[type="password"], .izaya-landing .il-card input[type="text"]{
          width:100%; padding:11px 13px; border:1.5px solid var(--il-line); border-radius:10px; font-size:13.5px; font-family:'Inter Variable', sans-serif;
          color:var(--il-navy); background:#FCFDFD; transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .izaya-landing .il-card input::placeholder{ color:#B7C2C6; }
        .izaya-landing .il-card input:focus{ outline:none; border-color:var(--il-mint); box-shadow:var(--il-focus-glow); background:#fff; }

        .il-signin-btn{ width:100%; background:linear-gradient(135deg, var(--il-teal), var(--il-navy)); box-shadow: 0 10px 24px -8px rgba(14,110,103,0.5); color:#fff; border:none; border-radius:11px; padding:13px; font-size:14px; font-weight:600; font-family:'Inter Variable', sans-serif; cursor:pointer; margin-top:4px; display:flex; align-items:center; justify-content:center; gap:8px; white-space:nowrap; transition: filter 0.18s ease, transform 0.1s ease, box-shadow 0.18s ease; }
        .il-signin-btn:hover:not(:disabled){ filter:brightness(1.1); transform:translateY(-1px); box-shadow:0 14px 28px -8px rgba(14,110,103,0.55); }
        .il-signin-btn:active:not(:disabled){ transform:translateY(0); }
        .il-signin-btn:disabled{ opacity:0.7; cursor:not-allowed; }
        .il-signin-btn svg{ width:16px; height:16px; flex-shrink:0; }

        .il-card-foot{ margin-top:16px; padding-top:15px; border-top:1px solid var(--il-line); font-size:12.5px; color:var(--il-body); text-align:center; line-height:1.55; }
        .il-card-foot a{ color:var(--il-teal); font-weight:600; text-decoration:none; }
        .il-card-foot a:hover{ text-decoration:underline; }

        .il-banner{ font-size:13px; padding:11px 13px; border-radius:10px; margin-bottom:14px; font-weight:500; }
        .il-banner-success{ background:rgba(47,191,159,0.1); border:1px solid rgba(47,191,159,0.3); color:var(--il-teal); }
        .il-banner-error{ background:#FEF2F2; border:1px solid #FECACA; color:#B91C1C; }

        .il-horizon{ position:relative; height:190px; margin-top:20px; overflow:hidden; z-index:1; }
        .il-horizon svg{ width:100%; height:100%; display:block; }

        /* ============ AUTOMATION PIPELINE — the moat ============ */
        .il-pipeline{ position:relative; z-index:2; padding:70px 48px 20px; }
        .il-pipeline-inner{ max-width:1160px; margin:0 auto; }
        .il-pipeline-head{ text-align:center; max-width:600px; margin:0 auto 50px; }
        .il-pipeline-head .il-tag{ font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--il-mint); margin-bottom:10px; }
        .il-pipeline-head h2{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:clamp(24px, 2.8vw, 34px); color:var(--il-navy); line-height:1.25; margin:0; }

        .il-flow{ position:relative; display:grid; grid-template-columns:repeat(5, 1fr); align-items:start; max-width:1080px; margin:0 auto; padding-top:10px; }
        .il-flow-track{ position:absolute; top:34px; left:calc(100%/10); right:calc(100%/10); height:3px; background:var(--il-line); border-radius:2px; overflow:hidden; }
        .il-flow-pulse{ position:absolute; top:0; left:-22%; height:100%; width:22%; background:linear-gradient(90deg, transparent, var(--il-mint), transparent); animation: ilPulseMove 5.5s linear infinite; }
        @keyframes ilPulseMove{ 0%{ left:-22%; } 100%{ left:100%; } }

        .il-flow-node{ position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; text-align:center; padding:0 6px; }
        .il-fn-dot{ width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:12px; background:var(--il-card); border:3px solid var(--il-mint); box-shadow:0 10px 22px -10px rgba(47,191,159,0.5); animation: ilFnPulse 6s ease-in-out infinite; }
        .il-fn-dot svg{ width:22px; height:22px; stroke:var(--il-teal); fill:none; stroke-linecap:round; stroke-linejoin:round; }
        .il-fn-label{ font-size:12px; font-weight:700; color:var(--il-navy); margin-bottom:3px; line-height:1.25; }
        .il-fn-tag{ font-size:9.5px; font-weight:700; letter-spacing:0.3px; text-transform:uppercase; padding:2px 8px; border-radius:999px; background:rgba(47,191,159,0.12); color:var(--il-teal); }

        @keyframes ilFnPulse{ 0%, 10%{ transform:scale(1); } 14%{ transform:scale(1.16); } 18%, 100%{ transform:scale(1); } }
        .il-flow-node:nth-child(2) .il-fn-dot{ animation-delay:0.85s; }
        .il-flow-node:nth-child(3) .il-fn-dot{ animation-delay:1.7s; }
        .il-flow-node:nth-child(4) .il-fn-dot{ animation-delay:2.55s; }
        .il-flow-node:nth-child(5) .il-fn-dot{ animation-delay:3.4s; }

        .il-branch-row{ display:grid; grid-template-columns:repeat(5, 1fr); max-width:1080px; margin:0 auto; }
        .il-branch-cell{ grid-column:2; display:flex; flex-direction:column; align-items:center; padding-top:6px; }
        .il-branch-line{ width:2px; height:26px; border-left:2px dashed rgba(46,143,199,0.5); }
        .il-branch-node{ margin-top:4px; display:flex; align-items:center; gap:9px; background:var(--il-card); border:1.5px solid rgba(46,143,199,0.35); border-radius:13px; padding:10px 13px; box-shadow:0 10px 22px -12px rgba(46,143,199,0.35); max-width:200px; }
        .il-bn-icon{ width:26px; height:26px; border-radius:8px; background:rgba(46,143,199,0.13); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .il-bn-icon svg{ width:13px; height:13px; stroke:var(--il-sky); fill:none; stroke-linecap:round; stroke-linejoin:round; }
        .il-bn-text .il-bt{ font-size:11px; font-weight:700; color:var(--il-navy); line-height:1.2; }
        .il-bn-text .il-bs{ font-size:9px; color:var(--il-slate-light); margin-top:1px; }

        .il-pipeline-callout{ text-align:center; margin-top:50px; display:flex; justify-content:center; gap:36px; flex-wrap:wrap; }
        .il-pc-item .il-pv{ font-family:'Fraunces Variable', serif; font-size:26px; font-weight:600; color:var(--il-navy); }
        .il-pc-item .il-pv span{ color:var(--il-sky); }
        .il-pc-item .il-pl{ font-size:11.5px; color:var(--il-body); margin-top:2px; }

        /* ============ MOAT: LIVE DEMOS ============ */
        .il-moat{ padding:90px 48px; }
        .il-moat-inner{ max-width:1160px; margin:0 auto; }
        .il-moat-head{ text-align:center; max-width:560px; margin:0 auto 54px; }
        .il-moat-head .il-tag{ font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--il-mint); margin-bottom:10px; }
        .il-moat-head h2{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:clamp(24px, 2.6vw, 32px); color:var(--il-navy); margin:0; }

        .il-moat-grid{ display:grid; grid-template-columns:1fr 1fr; gap:24px; }
        .il-moat-card{ background:var(--il-navy); border-radius:24px; padding:0; color:#fff; overflow:hidden; position:relative; }
        .il-moat-stage{ height:220px; position:relative; background:radial-gradient(70% 90% at 50% 100%, rgba(47,191,159,0.14), transparent); border-bottom:1px solid rgba(255,255,255,0.08); }
        .il-moat-caption{ padding:24px 28px 28px; }
        .il-moat-caption h3{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:18px; margin:0 0 6px; }
        .il-moat-caption p{ font-size:12.5px; color:rgba(255,255,255,0.6); margin:0; }

        .il-d1{ position:absolute; inset:0; }
        .il-d1-log{ position:absolute; left:30px; top:70px; width:120px; background:#fff; border-radius:10px; padding:11px; box-shadow:0 10px 24px rgba(0,0,0,0.25); animation: ilD1logmove 3.2s ease-in-out infinite; }
        .il-d1-log .il-ln{ height:6px; background:var(--il-line); border-radius:3px; margin-bottom:6px; }
        .il-d1-log .il-ln:nth-child(1){ width:70%; background:var(--il-sky); }
        .il-d1-log .il-ln:nth-child(2){ width:90%; }
        .il-d1-log .il-ln:nth-child(3){ width:50%; margin-bottom:0; }
        @keyframes ilD1logmove{ 0%,20%{ transform:translateX(0); opacity:1; } 55%,100%{ transform:translateX(150px); opacity:0.15; } }

        .il-d1-arrow{ position:absolute; left:158px; top:118px; width:60px; height:2px; background:var(--il-mint); opacity:0; animation: ilD1arrow 3.2s ease-in-out infinite; }
        .il-d1-arrow::after{ content:""; position:absolute; right:-1px; top:-4px; width:8px; height:8px; border-top:2px solid var(--il-mint); border-right:2px solid var(--il-mint); transform:rotate(45deg); }
        @keyframes ilD1arrow{ 0%,25%{ opacity:0; } 40%,70%{ opacity:1; } 90%,100%{ opacity:0; } }

        .il-d1-form{ position:absolute; right:30px; top:44px; width:150px; background:#fff; border-radius:10px; padding:14px; box-shadow:0 10px 24px rgba(0,0,0,0.25); }
        .il-d1-form .il-fh{ font-family:'IBM Plex Mono', monospace; font-size:8px; color:var(--il-slate-light); margin-bottom:8px; }
        .il-d1-form .il-fl{ height:5px; background:var(--il-line); border-radius:3px; margin-bottom:5px; width:0%; animation: ilD1fill 3.2s ease-in-out infinite; }
        .il-d1-form .il-fl:nth-child(2){ animation-delay:0.05s; }
        .il-d1-form .il-fl:nth-child(3){ animation-delay:0.15s; }
        .il-d1-form .il-fl:nth-child(4){ animation-delay:0.25s; }
        .il-d1-form .il-fl:nth-child(5){ animation-delay:0.35s; }
        @keyframes ilD1fill{ 0%,40%{ width:0%; background:var(--il-line); } 65%,100%{ width:88%; background:var(--il-mint); } }
        .il-d1-sig{ margin-top:10px; height:24px; border-top:1px dashed var(--il-line); position:relative; }
        .il-d1-sig svg{ position:absolute; top:2px; left:0; width:60px; height:20px; }
        .il-d1-sig path{ stroke:var(--il-navy); stroke-width:2; fill:none; stroke-dasharray:80; stroke-dashoffset:80; animation: ilD1sign 3.2s ease-in-out infinite; }
        @keyframes ilD1sign{ 0%,60%{ stroke-dashoffset:80; } 90%,100%{ stroke-dashoffset:0; } }

        .il-d2{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
        .il-d2-sheet{ width:220px; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 10px 24px rgba(0,0,0,0.25); }
        .il-d2-row{ display:flex; }
        .il-d2-cell{ flex:1; padding:8px 6px; font-size:8px; font-family:'IBM Plex Mono', monospace; color:var(--il-slate); border:1px solid var(--il-paper); text-align:center; }
        .il-d2-head .il-d2-cell{ background:var(--il-paper); font-weight:700; color:var(--il-navy); }
        .il-d2-head .il-d2-cell:nth-child(2){ animation: ilD2flag 3.6s ease-in-out infinite; }
        @keyframes ilD2flag{
          0%,30%{ background:var(--il-paper); color:var(--il-navy); }
          40%,60%{ background:rgba(214,95,76,0.18); color:var(--il-coral); }
          75%,100%{ background:rgba(47,191,159,0.18); color:var(--il-teal); }
        }
        .il-d2-badge{ position:absolute; top:14px; right:14px; display:flex; align-items:center; gap:5px; font-size:9px; font-weight:700; padding:4px 9px; border-radius:999px; opacity:0; animation: ilD2badge 3.6s ease-in-out infinite; }
        @keyframes ilD2badge{ 0%,35%{ opacity:0; transform:translateY(-4px); } 42%,62%{ opacity:1; transform:translateY(0); background:rgba(214,95,76,0.9); color:#fff; } 63%,73%{opacity:1; background:rgba(47,191,159,0.95); color:#fff;} 78%,100%{ opacity:0; } }

        /* ============ FEATURES ============ */
        .il-features{ padding:70px 48px; background:var(--il-card); border-top:1px solid var(--il-line); border-bottom:1px solid var(--il-line); }
        .il-features-inner{ max-width:1160px; margin:0 auto; }
        .il-section-head{ text-align:center; max-width:640px; margin:0 auto 40px; }
        .il-section-head h2{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:clamp(24px, 2.8vw, 32px); color:var(--il-navy); line-height:1.2; margin:0; }
        .il-fgrid{ display:grid; grid-template-columns:repeat(3, 1fr); gap:1px; background:var(--il-line); border:1px solid var(--il-line); border-radius:20px; overflow:hidden; }
        .il-fcard{ background:var(--il-card); padding:28px 24px; transition: background 0.2s ease; }
        .il-fcard:hover{ background:var(--il-paper); }
        .il-f-icon{ width:42px; height:42px; border-radius:12px; display:flex; align-items:center; justify-content:center; margin-bottom:16px; transition: transform 0.3s var(--il-ease); }
        .il-fcard:hover .il-f-icon{ transform:scale(1.1) rotate(-4deg); }
        .il-f-icon svg{ width:20px; height:20px; }
        .il-fcard h3{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:15.5px; color:var(--il-navy); margin:0 0 6px; }
        .il-fcard p{ font-size:12px; color:var(--il-body); line-height:1.5; margin:0; }

        /* ============ COMPLIANCE ============ */
        .il-compliance{ padding:70px 48px; }
        .il-compliance-inner{ max-width:1160px; margin:0 auto; text-align:center; }
        .il-compliance .il-tag{ font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--il-mint); margin-bottom:10px; }
        .il-compliance h2{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:clamp(24px, 2.6vw, 30px); color:var(--il-navy); margin:0 0 44px; }
        .il-badge-row{ display:flex; justify-content:center; gap:20px; flex-wrap:wrap; }
        .il-cbadge{ width:170px; background:var(--il-navy); border-radius:18px; padding:22px 18px; color:#fff; }
        .il-cbadge .il-ci{ width:38px; height:38px; border-radius:10px; background:rgba(47,191,159,0.18); display:flex; align-items:center; justify-content:center; margin:0 auto 12px; }
        .il-cbadge .il-ci svg{ width:18px; height:18px; stroke:var(--il-mint); fill:none; stroke-linecap:round; stroke-linejoin:round; }
        .il-cbadge .il-ct{ font-size:12.5px; font-weight:700; margin-bottom:4px; }
        .il-cbadge .il-cs{ font-family:'IBM Plex Mono', monospace; font-size:10px; color:rgba(255,255,255,0.55); }

        /* ============ PORTALS ============ */
        .il-portals{ padding:70px 48px; background:var(--il-card); border-top:1px solid var(--il-line); }
        .il-portals-inner{ max-width:900px; margin:0 auto; text-align:center; }
        .il-portals .il-tag{ font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--il-mint); margin-bottom:10px; }
        .il-portals h2{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:clamp(24px, 2.6vw, 30px); color:var(--il-navy); margin:0 0 44px; }
        .il-split-diagram{ display:flex; align-items:center; justify-content:center; gap:0; }
        .il-split-node{ width:120px; height:120px; border-radius:50%; background:linear-gradient(135deg, var(--il-teal), var(--il-navy)); display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Fraunces Variable', serif; font-weight:600; font-size:13px; text-align:center; flex-shrink:0; z-index:2; box-shadow:0 16px 30px -10px rgba(19,42,62,0.4); }
        .il-split-line{ width:90px; height:2px; background:repeating-linear-gradient(90deg, var(--il-line) 0 6px, transparent 6px 12px); }
        .il-split-end{ width:170px; padding:20px; border-radius:18px; text-align:left; }
        .il-split-end.il-prac{ background:rgba(47,191,159,0.08); border:1.5px solid rgba(47,191,159,0.3); }
        .il-split-end.il-admin{ background:rgba(46,143,199,0.08); border:1.5px solid rgba(46,143,199,0.3); }
        .il-split-end .il-et{ font-size:12.5px; font-weight:700; color:var(--il-navy); margin-bottom:4px; }
        .il-split-end .il-es{ font-size:11px; color:var(--il-body); }

        /* ============ DOWNLOAD ============ */
        .il-download{ padding:20px 48px 20px; }
        .il-dl-band{ max-width:1160px; margin:0 auto; border-radius:26px; padding:56px 60px; overflow:hidden; position:relative;
          background: radial-gradient(80% 120% at 85% 0%, rgba(47,191,159,0.18), transparent 55%), radial-gradient(70% 110% at 8% 100%, rgba(46,143,199,0.15), transparent 55%), linear-gradient(150deg, var(--il-navy) 0%, var(--il-navy-deep) 100%);
          display:grid; grid-template-columns:1.2fr 0.8fr; gap:50px; align-items:center; box-shadow:0 30px 70px -24px rgba(12,29,44,0.5); }
        .il-dl-copy h2{ font-family:'Fraunces Variable', serif; font-weight:600; font-size:clamp(24px, 2.6vw, 32px); color:#fff; margin:0 0 12px; }
        .il-dl-copy > p{ font-size:14px; color:rgba(255,255,255,0.75); line-height:1.6; margin:0 0 24px; max-width:440px; }
        .il-dl-store-row{ display:flex; gap:10px; margin-bottom:22px; flex-wrap:wrap; }
        .il-dl-store-btn{ display:flex; align-items:center; gap:9px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.16); border-radius:11px; padding:9px 15px; color:#fff; text-decoration:none; transition: background 0.18s ease, transform 0.1s ease; }
        .il-dl-store-btn:hover{ background:rgba(255,255,255,0.15); transform:translateY(-1px); }
        .il-dl-store-btn svg{ width:20px; height:20px; }
        .il-dl-store-btn .il-dsb-l{ font-size:9.5px; opacity:0.7; display:block; }
        .il-dl-store-btn .il-dsb-b{ font-size:12.5px; font-weight:700; }
        .il-dl-steps{ display:flex; flex-direction:column; gap:12px; margin-bottom:20px; }
        .il-dl-step{ display:flex; align-items:center; gap:12px; font-size:13px; color:rgba(255,255,255,0.88); }
        .il-dl-step .il-sn{ width:24px; height:24px; border-radius:50%; background:rgba(47,191,159,0.18); border:1.5px solid var(--il-mint); color:var(--il-mint); font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .il-dl-note{ display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:var(--il-mint); background:rgba(47,191,159,0.12); border:1px solid rgba(47,191,159,0.3); padding:8px 14px; border-radius:999px; }
        .il-dl-note svg{ width:13px; height:13px; stroke:var(--il-mint); stroke-width:2; fill:none; stroke-linecap:round; }
        .il-qr-tile{ justify-self:center; background:#fff; border-radius:20px; padding:22px 22px 16px; text-align:center; box-shadow:0 20px 50px -14px rgba(0,0,0,0.45); transition:transform 0.3s var(--il-ease); }
        .il-qr-tile:hover{ transform:scale(1.02); }
        .il-qr{ width:184px; height:184px; display:flex; align-items:center; justify-content:center; margin:0 auto; }
        .il-qr canvas{ border-radius:6px; }
        .il-qr-label{ margin-top:12px; font-size:12.5px; font-weight:700; color:var(--il-navy); }
        .il-qr-sub{ font-size:10.5px; color:var(--il-slate-light); margin-top:2px; font-family:'IBM Plex Mono', monospace; }

        .izaya-landing footer{ border-top:1px solid var(--il-line); padding:32px 48px 40px; }
        .il-foot-inner{ max-width:1080px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; gap:24px; flex-wrap:wrap; }
        .il-foot-brand{ display:flex; align-items:center; gap:12px; }
        .il-foot-brand svg{ width:88px; height:auto; }
        .il-foot-brand span{ font-size:12px; color:var(--il-slate-light); }
        .il-foot-links{ display:flex; gap:20px; }
        .il-foot-links a{ font-size:12px; color:var(--il-body); text-decoration:none; }
        .il-foot-links a:hover{ color:var(--il-navy); }
        .il-foot-hipaa{ display:flex; align-items:center; gap:6px; font-size:11.5px; font-weight:600; color:var(--il-teal); }
        .il-foot-hipaa svg{ width:12px; height:12px; }

        .il-mobile-banner{
          position:fixed; left:12px; right:12px; bottom:12px; z-index:60;
          display:flex; align-items:center; gap:12px;
          background:var(--il-navy); color:#fff;
          border-radius:16px; padding:14px 14px 14px 16px;
          box-shadow:0 16px 40px -12px rgba(12,29,44,0.55);
          animation: ilBannerUp 0.45s var(--il-ease) forwards;
        }
        @keyframes ilBannerUp{ from{ opacity:0; transform:translateY(16px); } to{ opacity:1; transform:translateY(0); } }
        .il-mobile-banner-icon{ width:36px; height:36px; border-radius:10px; background:rgba(47,191,159,0.18); border:1px solid rgba(47,191,159,0.4); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .il-mobile-banner-icon svg{ width:18px; height:18px; stroke:var(--il-mint); fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
        .il-mobile-banner-text{ flex:1; min-width:0; }
        .il-mobile-banner-text .t1{ font-size:13.5px; font-weight:600; }
        .il-mobile-banner-text .t2{ font-size:12px; color:rgba(255,255,255,0.82); margin-top:1px; }
        .il-mobile-banner-cta{ flex-shrink:0; background:var(--il-mint); color:var(--il-navy-deep); font-size:12.5px; font-weight:700; padding:9px 14px; border-radius:10px; text-decoration:none; white-space:nowrap; }
        .il-mobile-banner-close{ flex-shrink:0; background:none; border:none; color:rgba(255,255,255,0.5); padding:4px; cursor:pointer; line-height:0; }
        .il-mobile-banner-close svg{ width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; }

        @media (min-width: 768px){ .il-mobile-banner{ display:none; } }

        @media (max-width:1020px){
          .il-hero{ padding:110px 24px 0; }
          .il-hero-inner{ grid-template-columns:1fr; gap:44px; padding-bottom:24px; }
          .il-card{ margin:0 auto; }
          .il-moat-grid, .il-fgrid{ grid-template-columns:1fr; }
          .il-split-diagram{ flex-direction:column; gap:16px; }
          .il-split-line{ width:2px; height:40px; }
          .il-nav-link{ display:none; }
          .il-nav-slogan{ display:none; }
          .il-flow{ flex-direction:column; align-items:center; gap:28px; grid-template-columns:1fr; }
          .il-flow-track{ display:none; }
          .il-branch-row{ display:none; }
          .il-pipeline, .il-moat, .il-features, .il-compliance, .il-portals{ padding-left:22px; padding-right:22px; }
          .il-dl-band{ grid-template-columns:1fr; padding:44px 32px; text-align:center; }
          .il-dl-copy > p{ margin-left:auto; margin-right:auto; }
          .il-dl-steps, .il-dl-store-row{ align-items:center; justify-content:center; }
          /* The horizon graphic is decorative and mostly blank space above its
             wave line, inset by the hero's own side padding on top of that.
             Shrinking it wasn't enough to stop it reading as a layout bug on
             a narrow viewport, so it's dropped entirely below desktop. */
          .il-horizon{ display:none; }
          /* Every section below carries desktop-scale 70-90px top/bottom
             padding that was never tightened for mobile — stacked across
             5+ sections on a narrow, short viewport that reads as broken
             dead space rather than intentional breathing room. */
          .il-pipeline{ padding-top:32px; }
          .il-moat{ padding-top:48px; padding-bottom:48px; }
          .il-moat-head{ margin-bottom:32px; }
          .il-features{ padding-top:48px; padding-bottom:48px; }
          .il-compliance{ padding-top:48px; padding-bottom:48px; }
          .il-portals{ padding-top:48px; padding-bottom:48px; }
        }

        @media (prefers-reduced-motion: reduce){
          .il-hero-badge, .izaya-landing h1, .il-hero-sub, .il-hero-checklist, .il-auth-wrap, .il-flow-pulse, .il-fn-dot, .il-d1-log, .il-d1-arrow, .il-d1-fl, .il-d1-sig path, .il-d2-head .il-d2-cell, .il-d2-badge{
            animation:none !important; opacity:1 !important; transform:none !important;
          }
        }
      `}</style>

      {/* NAV */}
      <nav className={`il-nav${navScrolled ? ' scrolled' : ''}`}>
        <div className="il-nav-brand">
          <a aria-label="IZAYA home" href="https://izayaedge.com">
            <IzayaWordmark className="il-nav-logo" />
          </a>
          <span className="il-nav-slogan">Early Intervention Simplified</span>
        </div>
        <div className="il-nav-right">
          <a className="il-nav-link" href="#features">Why Izaya</a>
          <a className="il-nav-link" href="#moat">The Moat</a>
          <a className="il-nav-link" href="#download">Get the App</a>
          <a className="il-nav-cta" href="#login">Sign In</a>
        </div>
      </nav>

      {/* HERO */}
      <header className="il-hero" id="top">
        <div className="il-hero-inner">
          <div className="il-hero-copy">
            <div className="il-hero-badge">{PIN_ICON}Built for New Jersey EI Agencies</div>
            <h1>Automated billing,<br /><em>from session to invoice.</em></h1>
            <p className="il-hero-sub">Log a session. Izaya matches it, fills the form, and sends the invoice. No one has to touch it.</p>
            <div className="il-hero-checklist">
              <div className="il-hc-item"><span className="il-hc-check">{CHECK_ICON}</span>One record, from session to invoice</div>
              <div className="il-hc-item"><span className="il-hc-check">{CHECK_ICON}</span>State matches approve instantly. Office only reviews what doesn't match.</div>
              <div className="il-hc-item"><span className="il-hc-check">{CHECK_ICON}</span>HIPAA-compliant, with a full audit trail</div>
            </div>
          </div>

          <div className="il-auth-wrap">
            <div className="il-card" id="login">
              <h2>Welcome back</h2>
              <div className="il-card-nj-tag">{PIN_ICON}NJEIS Compliant</div>

              {resetSuccess && (
                <div className="il-banner il-banner-success">Your password has been reset. You can now sign in.</div>
              )}
              {error && (
                <div className="il-banner il-banner-error">{error}</div>
              )}

              <form onSubmit={handleLogin} noValidate>
                <div className="il-field">
                  <label htmlFor="login-company">Company Code</label>
                  <input
                    id="login-company"
                    type="text"
                    placeholder="your-company"
                    value={companySlug}
                    onChange={(e) => setCompanySlug(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    required
                  />
                </div>

                <div className="il-field">
                  <label htmlFor="login-email">Email</label>
                  <input
                    id="login-email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="il-field">
                  <div className="il-field-row">
                    <label htmlFor="login-password" style={{ marginBottom: 0 }}>Password</label>
                    <Link to="/forgot-password" className="il-forgot">Forgot password?</Link>
                  </div>
                  <PasswordInput
                    id="login-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-auto border-0 focus-visible:ring-0 focus-visible:border-0 rounded-none p-0 bg-transparent"
                    required
                  />
                </div>

                <button type="submit" className="il-signin-btn" disabled={isSubmitting}>
                  {isSubmitting ? 'Signing in…' : 'Sign In'}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </button>
              </form>

              <div className="il-card-foot">
                New agency? <Link to="/signup">Sign up your company</Link> and start a free 15-day trial.<br />
                Already have an account but no Company Code? Ask your agency admin.<br />
                Trouble signing in? <a href="mailto:support@izayaedge.com">support@izayaedge.com</a>
              </div>
            </div>
          </div>
        </div>

        <HorizonIllustration />
      </header>

      {/* AUTOMATION PIPELINE */}
      <section className="il-pipeline">
        <div className="il-pipeline-inner">
          <div className="il-pipeline-head il-reveal">
            <div className="il-tag">End to End</div>
            <h2>Matches approve themselves. Only exceptions need you.</h2>
          </div>

          <div className="il-flow il-reveal">
            <div className="il-flow-track"><div className="il-flow-pulse"></div></div>
            {PIPELINE_STEPS.map((step) => (
              <div className="il-flow-node" key={step.label}>
                <div className="il-fn-dot">{step.icon}</div>
                <div className="il-fn-label">{step.label}</div>
                <div className="il-fn-tag">Automated</div>
              </div>
            ))}
          </div>

          <div className="il-branch-row il-reveal">
            <div className="il-branch-cell">
              <div className="il-branch-line"></div>
              <div className="il-branch-node">
                <div className="il-bn-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg></div>
                <div className="il-bn-text"><div className="il-bt">Flagged for Review</div><div className="il-bs">Only on mismatch — the one human step</div></div>
              </div>
            </div>
          </div>

          <div className="il-pipeline-callout il-reveal">
            <div className="il-pc-item"><div className="il-pv"><span>5</span></div><div className="il-pl">automated steps</div></div>
            <div className="il-pc-item"><div className="il-pv">Exceptions<span> Only</span></div><div className="il-pl">is all a human ever reviews</div></div>
            <div className="il-pc-item"><div className="il-pv">Instant</div><div className="il-pl">on a match — no queue, no wait</div></div>
          </div>
        </div>
      </section>

      {/* MOAT: LIVE DEMOS */}
      <section className="il-moat" id="moat">
        <div className="il-moat-inner">
          <div className="il-moat-head il-reveal">
            <div className="il-tag">Inside the Automated Steps</div>
            <h2>How the form fills itself</h2>
          </div>
          <div className="il-moat-grid">
            <div className="il-moat-card il-reveal">
              <div className="il-moat-stage">
                <div className="il-d1">
                  <div className="il-d1-log"><div className="il-ln"></div><div className="il-ln"></div><div className="il-ln"></div></div>
                  <div className="il-d1-arrow"></div>
                  <div className="il-d1-form">
                    <div className="il-fh">NJEIS-020</div>
                    <div className="il-fl"></div><div className="il-fl"></div><div className="il-fl"></div><div className="il-fl"></div><div className="il-fl"></div>
                    <div className="il-d1-sig"><svg viewBox="0 0 60 20"><path d="M2 14 C 8 4, 14 18, 20 8 S 32 4, 38 12 S 50 6, 56 10" /></svg></div>
                  </div>
                </div>
              </div>
              <div className="il-moat-caption">
                <h3>One log. Form filled, signed, done.</h3>
                <p>No re-typing into the state PDF — ever.</p>
              </div>
            </div>

            <div className="il-moat-card il-reveal">
              <div className="il-moat-stage">
                <div className="il-d2">
                  <div className="il-d2-sheet">
                    <div className="il-d2-row il-d2-head"><div className="il-d2-cell">Date</div><div className="il-d2-cell">Svc Code</div><div className="il-d2-cell">Hrs</div></div>
                    <div className="il-d2-row"><div className="il-d2-cell">7/14</div><div className="il-d2-cell">DI</div><div className="il-d2-cell">1.0</div></div>
                    <div className="il-d2-row"><div className="il-d2-cell">7/15</div><div className="il-d2-cell">SLP</div><div className="il-d2-cell">0.5</div></div>
                  </div>
                  <div className="il-d2-badge">Header changed</div>
                </div>
              </div>
              <div className="il-moat-caption">
                <h3>State changes a column. We notice.</h3>
                <p>Flagged for review — never silently wrong.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="il-features" id="features">
        <div className="il-features-inner">
          <div className="il-section-head il-reveal">
            <h2>Built for the full billing lifecycle</h2>
          </div>
          <div className="il-fgrid">
            {FEATURES.map((f) => (
              <div className="il-fcard il-reveal" key={f.title}>
                <div className="il-f-icon" style={{ background: f.bg }}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPLIANCE */}
      <section className="il-compliance" id="compliance">
        <div className="il-compliance-inner">
          <div className="il-tag il-reveal">Security</div>
          <h2 className="il-reveal">Built to survive an audit</h2>
          <div className="il-badge-row">
            {COMPLIANCE_BADGES.map((b) => (
              <div className="il-cbadge il-reveal" key={b.title}>
                <div className="il-ci">{b.icon}</div>
                <div className="il-ct">{b.title}</div>
                <div className="il-cs">{b.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PORTALS */}
      <section className="il-portals">
        <div className="il-portals-inner">
          <div className="il-tag il-reveal">One System</div>
          <h2 className="il-reveal">Two experiences</h2>
          <div className="il-split-diagram il-reveal">
            <div className="il-split-end il-prac"><div className="il-et">Practitioner</div><div className="il-es">Patients, sessions, pay</div></div>
            <div className="il-split-line"></div>
            <div className="il-split-node">One<br />Record</div>
            <div className="il-split-line"></div>
            <div className="il-split-end il-admin"><div className="il-et">Admin</div><div className="il-es">Staff, billing, compliance</div></div>
          </div>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section className="il-download" id="download">
        <div className="il-dl-band il-reveal">
          <div className="il-dl-copy">
            <h2>Take Izaya with you</h2>
            <p>Practitioners can log sessions, message the office, and manage their schedule on the go. The full app installs straight from your phone's browser. No app store required.</p>
            <div className="il-dl-store-row">
              <a
                className="il-dl-store-btn"
                href={MOBILE_APP_INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M16.365 1.43c0 1.14-.462 2.15-1.217 2.9-.83.83-2.19 1.47-3.29 1.38-.14-1.1.44-2.24 1.19-2.99.83-.85 2.24-1.48 3.31-1.29zm4.51 16.4c-.44 1.02-.65 1.47-1.22 2.37-.79 1.26-1.9 2.83-3.29 2.84-1.23.02-1.55-.8-3.22-.79-1.67.01-2.02.81-3.25.79-1.39-.02-2.44-1.43-3.23-2.69-2.21-3.5-2.44-7.6-1.08-9.79.97-1.56 2.5-2.47 3.93-2.47 1.46 0 2.38.8 3.59.8 1.17 0 1.88-.8 3.57-.8 1.28 0 2.64.7 3.6 1.9-3.17 1.74-2.66 6.28.6 7.83z" />
                </svg>
                <span><span className="il-dsb-l">Install for</span><span className="il-dsb-b">iPhone</span></span>
              </a>
              <a
                className="il-dl-store-btn"
                href={MOBILE_APP_INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M3.6 2.15a1 1 0 00-.6.91v17.88a1 1 0 00.6.91l10.35-9.85L3.6 2.15z" />
                  <path d="M17.6 8.6l-3.05-1.74-3.36 3.14 3.36 3.14 3.06-1.74a1.6 1.6 0 000-2.8z" />
                  <path d="M13.9 11.9L4.1 21.2l9.5-5.42-1.7-1.88z" />
                  <path d="M13.9 12.1l1.7-1.88-9.5-5.42 7.8 7.3z" />
                </svg>
                <span><span className="il-dsb-l">Install for</span><span className="il-dsb-b">Android</span></span>
              </a>
            </div>
            <div className="il-dl-steps">
              <div className="il-dl-step"><span className="il-sn">1</span>Open your phone's camera</div>
              <div className="il-dl-step"><span className="il-sn">2</span>Scan the code &amp; open the link</div>
              <div className="il-dl-step"><span className="il-sn">3</span>Tap "Install" and you're done</div>
            </div>
            <div className="il-dl-note">
              <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>
              Works on iPhone and Android. No app store needed.
            </div>
          </div>

          <DownloadQR />
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="il-foot-inner">
          <div className="il-foot-brand">
            <IzayaWordmark />
            <span>© 2026 Izaya Consulting LLC</span>
          </div>
          <div className="il-foot-links">
            <a href="mailto:support@izayaedge.com">support@izayaedge.com</a>
          </div>
          <div className="il-foot-hipaa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>
            HIPAA Compliant
          </div>
        </div>
      </footer>

      {showMobileInstallBanner && (
        <div className="il-mobile-banner" role="dialog" aria-label="Install the Izaya app">
          <span className="il-mobile-banner-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
          </span>
          <div className="il-mobile-banner-text">
            <div className="t1">Install the Izaya app</div>
            <div className="t2">Faster access, right from your home screen</div>
          </div>
          <a
            href={MOBILE_APP_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="il-mobile-banner-cta"
            onClick={dismissMobileInstallBanner}
          >
            Install
          </a>
          <button
            type="button"
            className="il-mobile-banner-close"
            onClick={dismissMobileInstallBanner}
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default Login;
