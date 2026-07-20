import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import QRCode from 'qrcode';
import api from '@/api/axiosInstance';
import { PasswordInput } from '@/components/ui/password-input';
import { MOBILE_APP_INSTALL_URL } from '@/components/AuthLayout';

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

const FEATURES = [
  {
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none" /></svg>,
    title: 'Session documentation',
    body: 'Log every session — date, time, service type, location, and both signatures — in minutes, from a phone or a desktop.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M9 14l6-6m-5.5.5h.01m4.99 5h.01" /><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>,
    title: 'Automated NJEIS billing',
    body: 'Generate state-required NJEIS forms and pay invoices directly from logged sessions, and track every log from submitted to invoiced.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" /><path d="M9 11h6M9 15h3" /></svg>,
    title: 'Direct messaging',
    body: 'Message your office directly and hear back in the same thread — no phone tag, no lost emails.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><circle cx="9" cy="14" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r="1.3" fill="currentColor" stroke="none" /></svg>,
    title: 'Session scheduling',
    body: "Schedule a child's next visit and their parent gets an email with a calendar invite — no separate app or login required.",
  },
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

  const dismissMobileInstallBanner = () => {
    setShowMobileInstallBanner(false);
    try { localStorage.setItem(MOBILE_BANNER_SEEN_KEY, 'true'); } catch { /* ignore */ }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await api.post('/api/auth/login', { email, password });

      if (response.data.success) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('role', response.data.practitioner.role);

        const role = response.data.practitioner.role;
        const ADMIN_ROLES = ['staff_director', 'billing', 'ceo', 'account_specialist'];

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
          --il-navy:#132A3E; --il-navy-deep:#0C1D2C; --il-teal:#0E6E67; --il-mint:#2FBF9F; --il-sky:#2E8FC7;
          --il-paper:#F7FAF9; --il-card:#FFFFFF; --il-ink:#1B2B38; --il-slate:#5C6B73; --il-slate-light:#8FA0A8; --il-body:#3D4B54;
          --il-line:#E2EAE8; --il-focus-glow: 0 0 0 4px rgba(47,191,159,0.16); --il-ease: cubic-bezier(0.22, 1, 0.36, 1);
          font-family:'Inter', sans-serif; color:var(--il-ink); background:var(--il-paper); overflow-x:hidden;
        }
        .izaya-landing *{ box-sizing:border-box; }
        .izaya-landing ::selection{ background:rgba(47,191,159,0.25); }

        .il-nav{ position:fixed; top:0; left:0; right:0; z-index:50; display:flex; align-items:center; justify-content:space-between; padding:20px 48px; transition: background 0.3s ease, box-shadow 0.3s ease, padding 0.3s ease; }
        .il-nav.scrolled{ background:rgba(247,250,249,0.88); backdrop-filter:blur(14px); box-shadow:0 1px 0 rgba(19,42,62,0.06); padding:14px 48px; }
        .il-nav-logo{ width:118px; height:auto; display:block; }
        .il-nav-right{ display:flex; align-items:center; gap:26px; }
        .il-nav-link{ font-size:13.5px; font-weight:500; color:var(--il-ink); opacity:0.75; text-decoration:none; transition:color 0.15s ease, opacity 0.15s ease; }
        .il-nav-link:hover{ color:var(--il-navy); opacity:1; }
        .il-nav-cta{ font-size:13.5px; font-weight:600; color:var(--il-navy); text-decoration:none; padding:9px 18px; border:1.5px solid var(--il-navy); border-radius:999px; transition: background 0.18s ease, color 0.18s ease; }
        .il-nav-cta:hover{ background:var(--il-navy); color:#fff; }

        .izaya-landing .ilg-n{ stroke:var(--il-navy); fill:none; stroke-width:13; stroke-linecap:round; stroke-linejoin:round; }
        .izaya-landing .ilg-m{ stroke:var(--il-mint); fill:none; stroke-width:13; stroke-linecap:round; stroke-linejoin:round; }
        .izaya-landing .ilg-node{ fill:var(--il-mint); }

        .il-hero{ position:relative; min-height:100vh; display:flex; align-items:center; padding:120px 48px 240px; }
        .il-hero::before{ content:""; position:absolute; inset:0; background: radial-gradient(70% 60% at 78% 10%, rgba(46,143,199,0.10), transparent 60%), radial-gradient(60% 50% at 12% 20%, rgba(47,191,159,0.10), transparent 60%), linear-gradient(180deg, #EEF6F4 0%, var(--il-paper) 55%); pointer-events:none; }
        .il-hero-inner{ position:relative; z-index:2; width:100%; max-width:1200px; margin:0 auto; display:grid; grid-template-columns: 1.1fr 0.9fr; gap:72px; align-items:center; }

        .il-hero-copy{ max-width:560px; }
        .il-eyebrow{ display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:var(--il-teal); margin-bottom:22px; opacity:0; animation: ilUp 0.8s var(--il-ease) 0.1s forwards; }
        .izaya-landing h1{ font-family:'Fraunces', serif; font-weight:600; font-size:clamp(32px, 8vw, 64px); line-height:1.12; letter-spacing:-0.5px; color:var(--il-navy); margin:0 0 24px; opacity:0; animation: ilUp 0.8s var(--il-ease) 0.22s forwards; overflow-wrap:break-word; }
        .izaya-landing h1 em{ font-style:normal; position:relative; white-space:nowrap; }
        .izaya-landing h1 em::after{ content:""; position:absolute; left:0; right:0; bottom:6px; height:12px; background:rgba(47,191,159,0.28); z-index:-1; border-radius:3px; }
        .il-hero-sub{ font-size:17px; line-height:1.65; color:var(--il-body); margin-bottom:34px; max-width:480px; opacity:0; animation: ilUp 0.8s var(--il-ease) 0.34s forwards; }
        .il-hero-points{ display:flex; flex-direction:column; gap:14px; opacity:0; animation: ilUp 0.8s var(--il-ease) 0.46s forwards; }
        .il-point{ display:flex; align-items:center; gap:12px; font-size:14.5px; font-weight:500; color:var(--il-ink); }
        .il-point .il-pn{ width:26px; height:26px; border-radius:50%; background:var(--il-mint); display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 4px 10px -3px rgba(47,191,159,0.5); }
        .il-point .il-pn svg{ width:13px; height:13px; stroke:#fff; stroke-width:3; fill:none; stroke-linecap:round; stroke-linejoin:round; }

        @keyframes ilUp{ from{ opacity:0; transform:translateY(18px); } to{ opacity:1; transform:translateY(0); } }

        .il-auth-wrap{ position:relative; opacity:0; animation: ilUp 0.9s var(--il-ease) 0.4s forwards; }
        .il-auth-wrap::before{ content:""; position:absolute; inset:-40px -30px; background:radial-gradient(60% 55% at 50% 45%, rgba(47,191,159,0.13), transparent 70%); z-index:0; pointer-events:none; }
        .il-card{ position:relative; z-index:1; background:var(--il-card); border-radius:22px; padding:34px 34px 28px; box-shadow: 0 1px 2px rgba(19,42,62,0.05), 0 24px 60px -18px rgba(19,42,62,0.22); border:1px solid rgba(255,255,255,0.6); max-width:420px; margin-left:auto; }
        .il-card h2{ font-family:'Fraunces', serif; font-weight:600; font-size:24px; color:var(--il-navy); margin:0 0 4px; }
        .il-card-sub{ font-size:13.5px; color:var(--il-body); margin-bottom:22px; }
        .il-trust-bar{ display:flex; align-items:center; gap:8px; margin-bottom:24px; padding:9px 13px; background:rgba(47,191,159,0.07); border:1px solid rgba(47,191,159,0.18); border-radius:10px; font-size:12px; color:var(--il-teal); font-weight:600; width:fit-content; }
        .il-trust-bar svg{ width:13px; height:13px; flex-shrink:0; }

        .il-field{ margin-bottom:16px; }
        .il-field label{ display:block; font-size:13px; font-weight:600; color:var(--il-navy); margin-bottom:7px; }
        .il-field-row{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:7px; }
        .il-forgot{ font-size:12.5px; color:var(--il-teal); text-decoration:none; font-weight:600; }
        .il-forgot:hover{ text-decoration:underline; }
        .izaya-landing .il-card input[type="email"], .izaya-landing .il-card input[type="password"], .izaya-landing .il-card input[type="text"]{
          width:100%; padding:13px 15px; border:1.5px solid var(--il-line); border-radius:11px; font-size:14.5px; font-family:'Inter', sans-serif;
          color:var(--il-navy); background:#FCFDFD; transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .izaya-landing .il-card input::placeholder{ color:#B7C2C6; }
        .izaya-landing .il-card input:focus{ outline:none; border-color:var(--il-mint); box-shadow:var(--il-focus-glow); background:#fff; }

        .il-signin-btn{ width:100%; background:linear-gradient(135deg, var(--il-teal), var(--il-navy)); box-shadow: 0 10px 24px -8px rgba(14,110,103,0.5); color:#fff; border:none; border-radius:11px; padding:14px; font-size:14.5px; font-weight:600; font-family:'Inter', sans-serif; cursor:pointer; margin-top:4px; display:flex; align-items:center; justify-content:center; gap:8px; transition: filter 0.18s ease, transform 0.1s ease, box-shadow 0.18s ease; }
        .il-signin-btn:hover:not(:disabled){ filter:brightness(1.1); transform:translateY(-1px); box-shadow:0 14px 28px -8px rgba(14,110,103,0.55); }
        .il-signin-btn:active:not(:disabled){ transform:translateY(0); }
        .il-signin-btn:disabled{ opacity:0.7; cursor:not-allowed; }
        .il-signin-btn svg{ width:16px; height:16px; }

        .il-card-foot{ margin-top:18px; padding-top:16px; border-top:1px solid var(--il-line); font-size:12.5px; color:var(--il-body); text-align:center; line-height:1.55; }
        .il-card-foot a{ color:var(--il-teal); font-weight:600; text-decoration:none; }
        .il-card-foot a:hover{ text-decoration:underline; }

        .il-horizon{ position:absolute; left:0; right:0; bottom:0; height:220px; z-index:1; pointer-events:none; }
        .il-horizon svg{ width:100%; height:100%; display:block; }

        .il-spine{ position:relative; }
        .il-spine::before{ content:""; position:absolute; left:50%; top:0; bottom:0; width:0; border-left:2px dashed rgba(47,191,159,0.4); transform:translateX(-50%); }
        .il-spine-node{ position:relative; z-index:2; width:46px; height:46px; margin:0 auto; border-radius:50%; background:var(--il-mint); display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 8px var(--il-paper), 0 8px 20px -6px rgba(47,191,159,0.55); }
        .il-spine-node svg{ width:20px; height:20px; stroke:#fff; stroke-width:2.4; fill:none; stroke-linecap:round; stroke-linejoin:round; }

        .il-features{ position:relative; padding:72px 48px 96px; }
        .il-section-head{ text-align:center; max-width:640px; margin:36px auto 56px; }
        .il-section-head h2{ font-family:'Fraunces', serif; font-weight:600; font-size:clamp(28px, 3vw, 40px); color:var(--il-navy); line-height:1.15; margin:0 0 14px; }
        .il-section-head p{ font-size:15.5px; color:var(--il-body); line-height:1.65; margin:0; }

        .il-feature-grid{ position:relative; z-index:2; max-width:840px; margin:0 auto; display:grid; grid-template-columns:repeat(2, 1fr); gap:26px; }
        .il-feature{ background:var(--il-card); border:1px solid var(--il-line); border-radius:18px; padding:30px 28px; transition: transform 0.25s var(--il-ease), box-shadow 0.25s var(--il-ease), border-color 0.25s ease; }
        .il-feature:hover{ transform:translateY(-5px); box-shadow:0 20px 40px -16px rgba(19,42,62,0.18); border-color:rgba(47,191,159,0.4); }
        .il-f-icon{ width:48px; height:48px; border-radius:13px; background:linear-gradient(135deg, rgba(47,191,159,0.14), rgba(46,143,199,0.12)); display:flex; align-items:center; justify-content:center; margin-bottom:18px; }
        .il-f-icon svg{ width:23px; height:23px; stroke:var(--il-teal); stroke-width:1.9; fill:none; stroke-linecap:round; stroke-linejoin:round; }
        .il-feature h3{ font-family:'Fraunces', serif; font-weight:600; font-size:18.5px; color:var(--il-navy); margin:0 0 8px; }
        .il-feature p{ font-size:13.5px; color:var(--il-body); line-height:1.62; margin:0; }

        .il-download{ position:relative; padding:0 48px; }
        .il-dl-band{ position:relative; z-index:2; max-width:1080px; margin:36px auto 0; background: radial-gradient(80% 120% at 85% 0%, rgba(47,191,159,0.18), transparent 55%), radial-gradient(70% 110% at 8% 100%, rgba(46,143,199,0.15), transparent 55%), linear-gradient(150deg, var(--il-navy) 0%, var(--il-navy-deep) 100%); border-radius:26px; padding:60px 64px; display:grid; grid-template-columns:1.2fr 0.8fr; gap:56px; align-items:center; overflow:hidden; box-shadow:0 30px 70px -24px rgba(12,29,44,0.5); }
        .il-dl-band::before{ content:""; position:absolute; inset:0; background-image: radial-gradient(circle 3px at 12% 22%, rgba(47,191,159,0.5) 99%, transparent), radial-gradient(circle 2px at 30% 78%, rgba(255,255,255,0.25) 99%, transparent), radial-gradient(circle 2.5px at 55% 14%, rgba(47,191,159,0.35) 99%, transparent), radial-gradient(circle 2px at 88% 68%, rgba(255,255,255,0.2) 99%, transparent); pointer-events:none; }
        .il-dl-copy h2{ font-family:'Fraunces', serif; font-weight:600; font-size:clamp(26px, 2.8vw, 36px); color:#fff; line-height:1.15; margin:0 0 14px; }
        .il-dl-copy > p{ font-size:15px; color:rgba(255,255,255,0.78); line-height:1.65; margin:0 0 28px; max-width:440px; }
        .il-dl-steps{ display:flex; flex-direction:column; gap:14px; }
        .il-dl-step{ display:flex; align-items:center; gap:14px; font-size:14px; color:rgba(255,255,255,0.9); }
        .il-dl-step .il-sn{ width:28px; height:28px; border-radius:50%; background:rgba(47,191,159,0.18); border:1.5px solid var(--il-mint); color:var(--il-mint); font-size:12.5px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .il-dl-note{ margin-top:26px; display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--il-mint); background:rgba(47,191,159,0.12); border:1px solid rgba(47,191,159,0.3); padding:8px 14px; border-radius:999px; }
        .il-dl-note svg{ width:14px; height:14px; stroke:var(--il-mint); stroke-width:2; fill:none; stroke-linecap:round; }

        .il-qr-tile{ justify-self:center; background:#fff; border-radius:20px; padding:22px 22px 16px; text-align:center; box-shadow:0 20px 50px -14px rgba(0,0,0,0.45); transform:rotate(1.5deg); transition:transform 0.3s var(--il-ease); }
        .il-qr-tile:hover{ transform:rotate(0deg) scale(1.02); }
        .il-qr{ width:184px; height:184px; display:flex; align-items:center; justify-content:center; margin:0 auto; }
        .il-qr canvas{ border-radius:6px; }
        .il-qr-label{ margin-top:12px; font-size:12.5px; font-weight:600; color:var(--il-navy); }
        .il-qr-sub{ font-size:12px; color:var(--il-body); margin-top:2px; font-family:monospace; }

        .izaya-landing footer{ margin-top:96px; border-top:1px solid var(--il-line); padding:36px 48px 44px; }
        .il-foot-inner{ max-width:1080px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; gap:24px; flex-wrap:wrap; }
        .il-foot-brand{ display:flex; align-items:center; gap:14px; }
        .il-foot-brand svg{ width:96px; height:auto; }
        .il-foot-brand span{ font-size:12.5px; color:var(--il-body); }
        .il-foot-links{ display:flex; gap:22px; }
        .il-foot-links a{ font-size:12.5px; color:var(--il-body); text-decoration:none; }
        .il-foot-links a:hover{ color:var(--il-navy); }
        .il-foot-hipaa{ display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; color:var(--il-teal); }
        .il-foot-hipaa svg{ width:13px; height:13px; }

        .il-banner{ font-size:13px; padding:11px 13px; border-radius:10px; margin-bottom:16px; font-weight:500; }
        .il-banner-success{ background:rgba(47,191,159,0.1); border:1px solid rgba(47,191,159,0.3); color:var(--il-teal); }
        .il-banner-error{ background:#FEF2F2; border:1px solid #FECACA; color:#B91C1C; }

        @media (max-width: 1020px){
          .il-hero{ padding:110px 28px 200px; }
          .il-hero-inner{ grid-template-columns:1fr; gap:48px; }
          .il-card{ margin:0 auto; }
          .il-feature-grid{ grid-template-columns:1fr; max-width:480px; }
          .il-dl-band{ grid-template-columns:1fr; padding:44px 32px; text-align:center; }
          .il-dl-copy > p{ margin-left:auto; margin-right:auto; }
          .il-dl-steps{ align-items:flex-start; max-width:320px; margin:0 auto; }
          .il-nav{ padding:16px 22px; }
          .il-nav-link{ display:none; }
          .il-features, .il-download{ padding-left:22px; padding-right:22px; }
          .izaya-landing h1 em{ white-space:normal; }
        }

        @media (prefers-reduced-motion: reduce){
          .il-eyebrow, .izaya-landing h1, .il-hero-sub, .il-hero-points, .il-auth-wrap{
            animation:none !important; opacity:1 !important; transform:none !important;
          }
        }

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

        @media (min-width: 768px){
          .il-mobile-banner{ display:none; }
        }
      `}</style>

      {/* NAV */}
      <nav className={`il-nav${navScrolled ? ' scrolled' : ''}`}>
        <a aria-label="IZAYA home" href="#top">
          <IzayaWordmark className="il-nav-logo" />
        </a>
        <div className="il-nav-right">
          <a className="il-nav-link" href="#features">Why Izaya</a>
          <a className="il-nav-link" href="mailto:support@izayaedge.com">Support</a>
          <a className="il-nav-cta" href="#download">Get the App</a>
        </div>
      </nav>

      {/* HERO */}
      <header className="il-hero" id="top">
        <div className="il-hero-inner">

          <div className="il-hero-copy">
            <div className="il-eyebrow">Early Intervention Simplified</div>
            <h1>Every session, every message, <em>handled in one place.</em></h1>
            <p className="il-hero-sub">Izaya gives early intervention practitioners — and the agencies that manage them — one place to log sessions, message the office, schedule visits, and handle state billing. Less paperwork, faster turnaround.</p>
            <div className="il-hero-points">
              <div className="il-point"><span className="il-pn">{CHECK_ICON}</span>Built for practitioners &amp; the agencies that manage them</div>
              <div className="il-point"><span className="il-pn">{CHECK_ICON}</span>HIPAA-compliant &amp; secured by design</div>
              <div className="il-point"><span className="il-pn">{CHECK_ICON}</span>On any device — no app store required</div>
            </div>
          </div>

          <div className="il-auth-wrap">
            <div className="il-card">
              <h2>Welcome back</h2>
              <p className="il-card-sub">Sign in to your Izaya dashboard</p>

              <div className="il-trust-bar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                Secured &amp; HIPAA Compliant
              </div>

              {resetSuccess && (
                <div className="il-banner il-banner-success">Your password has been reset. You can now sign in.</div>
              )}
              {error && (
                <div className="il-banner il-banner-error">{error}</div>
              )}

              <form onSubmit={handleLogin} noValidate>
                <div className="il-field">
                  <label htmlFor="login-email">Email Address</label>
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
                  {isSubmitting ? 'Signing in…' : 'Sign In to Dashboard'}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </button>
              </form>

              <div className="il-card-foot">
                New to Izaya? Your agency administrator will set up your account.<br />
                Trouble signing in? <a href="mailto:support@izayaedge.com">support@izayaedge.com</a>
              </div>
            </div>
          </div>

        </div>

        <HorizonIllustration />
      </header>

      {/* FEATURES */}
      <section className="il-features il-spine" id="features">
        <div className="il-spine-node" aria-hidden="true">{CHECK_ICON}</div>

        <div className="il-section-head">
          <h2>One system for documentation, billing, and staff oversight</h2>
          <p>Early intervention agencies juggle session logs, state paperwork, and payroll across a whole team of practitioners. Izaya keeps it together — from the first signature to the final invoice.</p>
        </div>

        <div className="il-feature-grid">
          {FEATURES.map((f) => (
            <div className="il-feature" key={f.title}>
              <div className="il-f-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* DOWNLOAD */}
      <section className="il-download il-spine" id="download">
        <div className="il-spine-node" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5" /><path d="M5 20h14" /></svg>
        </div>

        <div className="il-dl-band">
          <div className="il-dl-copy">
            <h2>Take Izaya with you</h2>
            <p>Practitioners can log sessions, message the office, and manage their schedule on the go — the full app installs straight from your phone's browser, no app store, ready in seconds.</p>
            <div className="il-dl-steps">
              <div className="il-dl-step"><span className="il-sn">1</span>Open your phone's camera</div>
              <div className="il-dl-step"><span className="il-sn">2</span>Scan the code &amp; open the link</div>
              <div className="il-dl-step"><span className="il-sn">3</span>Tap "Install" — that's it</div>
            </div>
            <div className="il-dl-note">
              <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>
              Works on iPhone &amp; Android — no app store needed
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
