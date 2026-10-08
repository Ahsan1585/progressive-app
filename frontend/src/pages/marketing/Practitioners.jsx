import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { IZAYA_ONE_INSTALL_URL } from '../../components/AuthLayout';

const PHONE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>;
const FILE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>;
const CALENDAR_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
const VIDEO_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>;
const MAIL_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg>;
const SLIDERS_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h14M22 18h-2" /><circle cx="17" cy="6" r="2" /><circle cx="7" cy="12" r="2" /><circle cx="19" cy="18" r="2" /></svg>;
const CIRCLE_CHECK_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>;

const FEATURES = [
  {
    icon: PHONE_ICON,
    title: 'Log sessions on your phone',
    body: 'Client, service, date, start and end time, captured in the field with a running total-time calculation and parent plus practitioner signatures.',
  },
  {
    icon: FILE_ICON,
    title: 'Generate your own SEVF',
    body: 'No office to send your logs to and wait on. Certify your own sessions and generate the state-mandated service verification form yourself, split correctly by agency and by month.',
  },
  {
    icon: CALENDAR_ICON,
    title: 'Schedule appointments',
    body: 'Keep your own caseload and calendar in one place, with automatic reminders for families.',
  },
  {
    icon: VIDEO_ICON,
    title: 'Telepractice, built in',
    body: 'Conduct a video session, then send the signature link straight to email. No printing, no paper trail.',
  },
  {
    icon: MAIL_ICON,
    title: 'Email your SEVF directly to an agency',
    body: 'Skip the mail. Once a SEVF is generated, send it straight to whichever early intervention agency you did the work for, right from the app.',
  },
  {
    icon: SLIDERS_ICON,
    title: 'Set up your own vocabulary',
    body: 'Disciplines, service types, and the agencies you bill to, all self-service and all yours to configure.',
  },
];

const STATS = [
  { num: '$30', label: 'Flat monthly fee, no matter how many agencies you bill' },
  { num: '15', label: 'Days free, no card required to start' },
  { num: '0', label: 'Spreadsheets, invoices, or billing office to wait on' },
];

function Reveal({ as: Tag = 'div', className = '', style, children }) {
  const ref = useScrollReveal();
  return (
    <Tag ref={ref} className={`mk-reveal ${className}`} style={style}>
      {children}
    </Tag>
  );
}

export default function Practitioners() {
  return (
    <MarketingLayout isOne>
      {/* HERO, same asymmetric split + floating badge pattern as Home */}
      <section className="mk-home-hero">
        <div className="mk-home-hero-inner">
          <div>
            <div className="mk-eyebrow">For independent practitioners</div>
            <h1>Your company hasn't signed up with Izaya.<br /><span className="mk-accent">You still can.</span></h1>
            <p className="mk-home-hero-sub">
              Register directly, log sessions from your phone, and generate your own SEVFs, no agency sign-up required.
            </p>
            <div className="mk-home-hero-ctas">
              <Link to="/signup/independent" className="mk-btn-primary">
                Sign up, $30/month
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
              </Link>
              <a href={IZAYA_ONE_INSTALL_URL} target="_blank" rel="noopener noreferrer" className="mk-btn-text">Download the Izaya One app</a>
            </div>
            <p className="mk-home-hero-note">15-day free trial. No card required to start.</p>
          </div>

          <div className="mk-home-hero-media">
            <div className="mk-home-hero-photo">
              <img
                src={`${import.meta.env.BASE_URL}hero-practitioner.jpg`}
                alt="An independent early intervention practitioner logging a session on her phone"
                onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'block'; }}
              />
              <div className="mk-home-hero-photo-fallback" style={{ display: 'none' }}>
                Add hero photo at<br /><code>frontend/public/hero-practitioner.jpg</code>
              </div>
            </div>
            <div className="mk-home-hero-badge">
              {FILE_ICON}
              <span>Your own SEVFs,<br />generated for you</span>
            </div>
          </div>
        </div>
      </section>

      {/* STAT ROW */}
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-section-inner">
          <Reveal className="mk-stat-row">
            {STATS.map((s) => (
              <div className="mk-stat" key={s.label}>
                <div className="mk-stat-num">{s.num}</div>
                <div className="mk-stat-label">{s.label}</div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ICON FEATURE GRID */}
      <section className="mk-section mk-alt">
        <div className="mk-section-inner">
          <Reveal as="div" className="mk-section-head mk-center">
            <h2>Everything a tenant-registered practitioner gets, adapted for working independently</h2>
          </Reveal>
          <div className="mk-feature-grid">
            {FEATURES.map((f, i) => (
              <Reveal as="div" className="mk-feature-card" style={{ transitionDelay: `${i * 60}ms` }} key={f.title}>
                <div className="mk-feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* WHAT'S DIFFERENT, text + real app screenshot */}
      <section className="mk-section">
        <div className="mk-section-inner mk-split-2" style={{ alignItems: 'center' }}>
          <Reveal>
            <div className="mk-eyebrow">What's different</div>
            <h3>No office. No invoice. No problem.</h3>
            <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 12 }}>
              A tenant-registered practitioner's logs go to their company's billing team for review, who issue an invoice for the practitioner's pay. As an independent practitioner, you certify your own sessions directly, no review queue, no waiting, and instead of an invoice you generate the SEVF your agencies need for reimbursement.
            </p>
            <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 10 }}>
              You pay Izaya directly, $30 a month, instead of billing through a company's subscription. Everything else, validation, signatures, scheduling, telepractice, works exactly the same.
            </p>
            <div className="mk-bullets" style={{ marginTop: 18 }}>
              <div className="mk-bullet">{CIRCLE_CHECK_ICON}One child, one SEVF, split correctly across agencies and months</div>
              <div className="mk-bullet">{CIRCLE_CHECK_ICON}HIPAA-compliant and security-first, same as every Izaya EIS account</div>
            </div>
          </Reveal>
          <Reveal>
            <div className="mk-phone-mockup">
              <div className="mk-phone-mockup-screen">
                <img src={`${import.meta.env.BASE_URL}Pract_Dash.png`} alt="The Izaya EISimplified practitioner app home screen, showing logs this month, hours, and a quick action to log a session" />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FINAL CTA, same dark band as Home */}
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-section-inner">
          <div className="mk-cta-band">
            <div>
              <h2>Start your free trial</h2>
              <p>15 days, no card required. Set up in a few minutes and log your first session today.</p>
            </div>
            <Link to="/signup/independent" className="mk-btn-primary">Sign up</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
