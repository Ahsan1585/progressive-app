import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';

const CHECK_ICON = <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>;
const PEOPLE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
const CIRCLE_CHECK_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>;
const REFRESH_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M8 16H3v5" /></svg>;
const FILE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>;

const EXCEPTION_BULLETS = [
  'Billing specialists return error logs within the platform',
  'Practitioners correct instantly',
  'No emails. No phone calls. No delays.',
];

const CHECKLIST = [
  'No manual SEVF',
  'No invoice preparation',
  'No calculations',
  'No chasing corrections',
];

const SWITCH_CARDS = [
  { title: 'Save time', body: 'Automate every step of the billing cycle and focus on what matters most.' },
  { title: 'Reduce errors', body: 'Smart validation and auto-approval keep every log accurate before it moves.' },
  { title: 'Get paid faster', body: 'Faster corrections and automated billing accelerate reimbursements.' },
  { title: 'Complete compliance', body: 'Built for EI, state, and payer requirements from the first entry onward.' },
  { title: 'Better together', body: 'Practitioners, billing teams, and management aligned on one platform.' },
];

const AUTOMATED = [
  { title: 'Error-free logs', sub: 'Auto approved', icon: CIRCLE_CHECK_ICON },
  { title: 'Corrected logs', sub: 'Instantly processed', icon: REFRESH_ICON },
  { title: 'SEVF & invoice', sub: 'Generated for you', icon: FILE_ICON },
];

const STEPS = [
  { n: 1, title: 'Practitioner logs the session on their phone', tag: 'Quick. Easy. Done.' },
  { n: 2, title: 'System validates automatically', tag: 'Built-in smart validations.' },
  { n: 3, title: 'Any errors are returned in the platform', tag: 'No emails. No calls.' },
  { n: 4, title: 'Practitioner corrects instantly', tag: 'Corrected in seconds.' },
  { n: 5, title: 'All logs are error-free', tag: '100% clean logs.' },
  { n: 6, title: 'SEVF and invoice generated', tag: 'Time and amount calculated.' },
];

export default function Home() {
  return (
    <MarketingLayout>
      {/* HERO */}
      <section className="mk-home-hero">
        <div className="mk-home-hero-inner">
          <div>
            <div className="mk-eyebrow">Smart billing platform</div>
            <h1>Weeks of billing work,<br /><span className="mk-accent">done in minutes.</span></h1>
            <p className="mk-home-hero-sub">
              Izaya EISimplified™ is the billing platform built for early intervention agencies. Your practitioners log a session — the system handles validation, SEVF, and invoicing.
            </p>
            <div className="mk-home-hero-ctas">
              <Link to="/contact" className="mk-btn-primary">
                Schedule a demo
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
              </Link>
              <Link to="/download" className="mk-btn-text">Download the practitioner app</Link>
            </div>
            <p className="mk-home-hero-note">Less paperwork. Faster billing. More time for families.</p>
          </div>

          <div className="mk-home-hero-media">
            <div className="mk-home-hero-photo">
              <img
                src={`${import.meta.env.BASE_URL}practitionerfamily.png`}
                alt="An early intervention practitioner reviewing a session log on a tablet while a family plays with their child in the background"
                onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'block'; }}
              />
              <div className="mk-home-hero-photo-fallback" style={{ display: 'none' }}>
                Add hero photo at<br /><code>frontend/public/practitionerfamily.png</code>
              </div>
            </div>
            <div className="mk-home-hero-badge">
              {PEOPLE_ICON}
              <span>More time<br />for families</span>
            </div>
          </div>
        </div>
      </section>

      {/* CORE IDEA */}
      <section className="mk-section">
        <div className="mk-section-inner mk-idea-grid">
          <div>
            <div className="mk-eyebrow">The core idea</div>
            <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 32px)', marginBottom: 14 }}>Log a session. The system handles the rest.</h2>
            <p style={{ fontSize: 17, color: 'var(--mk-body)', lineHeight: 1.6 }}>
              Practitioners simply log a session on their phone. Izaya EISimplified™ automatically validates entries, flags exceptions, approves error-free logs, and generates SEVF forms and invoices — without a single spreadsheet.
            </p>
          </div>
          <div className="mk-checklist">
            {CHECKLIST.map((item) => (
              <div className="mk-check-item" key={item}>
                <span className="mk-check-dot">{CHECK_ICON}</span>{item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY AGENCIES SWITCH */}
      <section className="mk-section mk-alt">
        <div className="mk-section-inner">
          <div className="mk-section-head mk-center">
            <div className="mk-eyebrow">Why agencies switch</div>
            <h2>Built to remove the billing bottleneck</h2>
          </div>
          <div className="mk-cards-5">
            {SWITCH_CARDS.map((c) => (
              <div className="mk-card" key={c.title}>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EXCEPTION-BASED WORKFLOW */}
      <section className="mk-section">
        <div className="mk-section-inner mk-split-2">
          <div className="mk-panel">
            <div className="mk-panel-head mk-violet">Smart exception-based workflow</div>
            <div className="mk-panel-body">
              <h3>Only logs with errors need attention.</h3>
              <div className="mk-bullets">
                {EXCEPTION_BULLETS.map((b) => (
                  <div className="mk-bullet" key={b}>{CIRCLE_CHECK_ICON}{b}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="mk-panel">
            <div className="mk-panel-head mk-green">Everything else is fully automated</div>
            <div className="mk-panel-body">
              <div className="mk-tile-row">
                {AUTOMATED.map((a) => (
                  <div className="mk-tile" key={a.title}>
                    {a.icon}
                    <div className="mk-tile-title">{a.title}</div>
                    <div className="mk-tile-sub">{a.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SIX STEPS */}
      <section className="mk-section mk-alt">
        <div className="mk-section-inner">
          <div className="mk-steps-head">
            <div>
              <div className="mk-eyebrow">How Izaya EISimplified™ works</div>
              <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 32px)' }}>Six steps, one uninterrupted flow</h2>
            </div>
            <Link to="/how-it-works" className="mk-btn-text">See the full walkthrough →</Link>
          </div>
          <div className="mk-steps">
            {STEPS.map((s) => (
              <div className="mk-step-card" key={s.n}>
                <div className="mk-step-num">{s.n}</div>
                <h3>{s.title}</h3>
                <div className="mk-step-tag">{s.tag}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRACTITIONER APP CTA */}
      <section className="mk-app-cta">
        <div className="mk-app-cta-inner">
          <div>
            <h2>Your practitioners log from their phone</h2>
            <p>Install the practitioner app on any iPhone or Android device — no app store account, no IT ticket. Sessions, signatures, drafts, and returned logs, all in one place.</p>
          </div>
          <Link to="/download" className="mk-btn-primary">Get the app</Link>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-section-inner">
          <div className="mk-cta-band">
            <div>
              <h2>Weeks of billing work.<br />Done in minutes.</h2>
              <p>Let us show you how Izaya EISimplified™ can transform your billing workflow — from session log to SEVF and invoice.</p>
            </div>
            <div className="mk-cta-band-actions">
              <Link to="/contact" className="mk-btn-primary">Schedule a demo today</Link>
              <p className="mk-cta-band-call">Or call <a href="tel:+14054737367">(405) 473-7367</a></p>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
