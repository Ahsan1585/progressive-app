import { Link, useSearchParams } from 'react-router-dom';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { IZAYA_ONE_INSTALL_URL } from '../../components/AuthLayout';

const HEART_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7.5-5.2-10-9.8C.3 7.6 2.3 4 6 4c2 0 3.6 1.1 4.5 2.6C11.4 5.1 13 4 15 4c3.7 0 5.7 3.6 4 7.2-2.5 4.6-10 9.8-10 9.8Z" /></svg>;
const PHONE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>;
const FILE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>;
const CALENDAR_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
const SLIDERS_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h14M22 18h-2" /><circle cx="17" cy="6" r="2" /><circle cx="7" cy="12" r="2" /><circle cx="19" cy="18" r="2" /></svg>;
const SHIELD_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5.5 3.4 9.7 8 11 4.6-1.3 8-5.5 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
const SPARKLE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>;
const UNDERLINE_SVG = <svg viewBox="0 0 200 14" preserveAspectRatio="none" fill="none"><path d="M2 10c30-8 140-8 196 1" stroke="currentColor" strokeWidth="5" strokeLinecap="round" /></svg>;
const TRIAL_CALENDAR_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M9 15l2 2 4-4" /></svg>;
const TRIAL_ARROW_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mk-warm-trial-arrow"><path d="M5 12h14M13 5l7 7-7 7" /></svg>;
const CHECK_CLOUD_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17 8a4 4 0 0 1-.5 8H7Z" /><path d="m9.5 13 2 2 3.5-3.5" /></svg>;
const SIGNATURE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17c2-1 3-3 3.5-5S7 8 8.5 8s1 3-.5 6 .5 3 2.5 1 3-4 4.5-4 .5 2 2 2 2-1 3.5-2" /><path d="M3 21h18" /></svg>;
const NOTE_PEN_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m9.5 15.5 5-5 1.5 1.5-5 5H9.5v-1.5Z" /></svg>;

const QUICK_FACTS = [
  { icon: PHONE_ICON, label: 'Just log the session' },
  { icon: FILE_ICON, label: 'Own SEVF, built for you' },
  { icon: CHECK_CLOUD_ICON, label: 'Own invoice, built for you' },
  { icon: CALENDAR_ICON, label: 'Your schedule, in one place' },
  { icon: SIGNATURE_ICON, label: 'Parent signatures on the phone' },
  { icon: NOTE_PEN_ICON, label: 'Enter your own EIMS notes' },
];

const BADGE_COLORS = [
  { tint: '#E7F1F8', ink: 'var(--mk-warm-blue)' },
  { tint: '#FBEAF0', ink: 'var(--mk-warm-pink)' },
  { tint: '#E9F5EE', ink: 'var(--mk-warm-green)' },
  { tint: 'var(--mk-warm-sand-deep)', ink: 'var(--mk-warm-coral-deep)' },
  { tint: '#F0EBF8', ink: 'var(--mk-warm-violet)' },
  { tint: '#FBF2DF', ink: 'var(--mk-warm-amber)' },
];

const DAY_IN_LIFE = [
  {
    icon: PHONE_ICON,
    title: 'Log the visit, that\'s it',
    body: "Who you saw, what you worked on, how long it ran. Tap it in on your phone before you've even left the driveway. Nothing else to remember.",
  },
  {
    icon: FILE_ICON,
    title: 'Your SEVF, built automatically',
    body: 'The state form every agency needs gets generated straight from the visit you just logged. No blank form, no copying numbers over by hand.',
  },
  {
    icon: CHECK_CLOUD_ICON,
    title: 'Your invoice, done the same way',
    body: 'Hours and rates calculated for you, separated out by agency so each one gets exactly what it needs. Print it, or send it straight over.',
  },
  {
    icon: CALENDAR_ICON,
    title: 'Every family, one schedule',
    body: "All your visits in a single calendar, with a reminder before each one so nobody's left waiting and you're never guessing who's next.",
  },
  {
    icon: SIGNATURE_ICON,
    title: 'Parent signatures, right on your phone',
    body: "No more carrying paper for a signature. Meet by video when that's easier, and get the sign-off from a parent's own phone after.",
  },
  {
    icon: SLIDERS_ICON,
    title: 'Your own services, your own agencies',
    body: 'Set up the vocabulary you actually use, once. From then on, it only ever shows you the services and agencies that apply to you.',
  },
];

const NUMBERS = [
  { num: '30', label: 'days to try it free, no card needed to start', color: 'var(--mk-warm-blue)' },
  { num: '0', label: 'paperwork left over for you to chase down later', color: 'var(--mk-warm-green)' },
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
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');
  const signupHref = refCode ? `/signup/independent?ref=${encodeURIComponent(refCode)}` : '/signup/independent';

  return (
    <MarketingLayout isOne>
      <div className="mk-warm">
        {/* HERO */}
        <section className="mk-warm-hero">
          <div className="mk-warm-blob" style={{ width: 160, height: 160, top: -40, left: '38%', background: 'var(--mk-warm-blue)', opacity: 0.12 }} />
          <div className="mk-warm-blob" style={{ width: 120, height: 120, bottom: 10, left: '4%', background: 'var(--mk-warm-green)', opacity: 0.14 }} />
          <div className="mk-warm-blob" style={{ width: 90, height: 90, top: '30%', right: '6%', background: 'var(--mk-warm-violet)', opacity: 0.12 }} />
          <div className="mk-warm-hero-banner-strip">
            <img
              src={`${import.meta.env.BASE_URL}practitioners-hero-banner.png`}
              alt="A practitioner logging a session on her phone with a child, next to a list: Log Sessions, Get Parent Signatures, Print SEVFs and Invoices, Enter EIMS Notes, all on your phone"
            />
          </div>
          <div className="mk-warm-hero-inner mk-warm-hero-inner-centered">
            <div className="mk-warm-eyebrow" style={{ justifyContent: 'center' }}>{HEART_ICON}For independent practitioners</div>
            <h1>You work on your own. Your <span className="mk-warm-underline">paperwork{UNDERLINE_SVG}</span> should too.</h1>
            <p className="mk-warm-hero-sub">
              Izaya One is a simple app for early intervention practitioners who don't go through a company. Log your visits from your phone, and let it take care of the forms.
            </p>
            <div className="mk-warm-hero-ctas" style={{ justifyContent: 'center' }}>
              <Link to={signupHref} className="mk-warm-btn-primary">
                Get started, $19.99/month
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
              </Link>
              <a href={IZAYA_ONE_INSTALL_URL} target="_blank" rel="noopener noreferrer" className="mk-btn-text">Download the Izaya One app</a>
            </div>
            <p className="mk-warm-hero-note">Free for 30 days. No card required to start.</p>
          </div>
        </section>

        {/* QUICK FACTS + PRICE + TRIAL, one dense block, no dead air between them */}
        <section className="mk-section" style={{ paddingTop: 0, paddingBottom: 24 }}>
          <div className="mk-section-inner">
            <Reveal className="mk-warm-quickfacts" style={{ marginBottom: 18 }}>
              {QUICK_FACTS.map((f, i) => (
                <div
                  className="mk-warm-quickfact"
                  style={{ '--mk-badge-tint': BADGE_COLORS[i].tint, '--mk-badge-ink': BADGE_COLORS[i].ink }}
                  key={f.label}
                >
                  <div className="mk-warm-quickfact-icon">{f.icon}</div>
                  <div className="mk-warm-quickfact-label">{f.label}</div>
                </div>
              ))}
            </Reveal>
            <Reveal className="mk-warm-price-band" style={{ marginBottom: 14 }}>
              <div className="mk-warm-price-sticker">
                <span className="mk-warm-price-badge">Your rate, locked in</span>
                <span className="mk-warm-price-now">$19.99<span>/month, flat</span></span>
                <span className="mk-warm-price-foot">No matter how many agencies you work with</span>
              </div>
              {NUMBERS.map((s) => (
                <div className="mk-warm-number" key={s.label}>
                  <div className="mk-warm-number-num" style={{ color: s.color }}>{s.num}</div>
                  <div className="mk-warm-number-label">{s.label}</div>
                </div>
              ))}
            </Reveal>
            <Reveal>
              <Link to={signupHref} className="mk-warm-trial-banner">
                <span className="mk-warm-trial-banner-icon">{TRIAL_CALENDAR_ICON}</span>
                <span className="mk-warm-trial-banner-text">
                  Start your free trial for <span className="mk-warm-trial-highlight">30 days</span>
                </span>
                {TRIAL_ARROW_ICON}
              </Link>
            </Reveal>
          </div>
        </section>

        {/* A DAY WITH IZAYA ONE */}
        <section className="mk-warm-section mk-section mk-alt">
          <div className="mk-warm-blob" style={{ width: 130, height: 130, top: 20, right: '8%', background: 'var(--mk-warm-pink)', opacity: 0.14 }} />
          <div className="mk-warm-blob" style={{ width: 100, height: 100, bottom: -20, left: '10%', background: 'var(--mk-warm-amber)', opacity: 0.15 }} />
          <div className="mk-section-inner">
            <Reveal as="div" className="mk-section-head mk-center">
              <div className="mk-warm-eyebrow" style={{ justifyContent: 'center' }}>{SPARKLE_ICON}What it does for you</div>
              <h2>A day with Izaya One</h2>
              <p>From your first visit of the day to the last form you send, here's what's easier.</p>
            </Reveal>
            <div className="mk-feature-grid">
              {DAY_IN_LIFE.map((f, i) => (
                <Reveal
                  as="div"
                  className="mk-feature-card"
                  style={{ transitionDelay: `${i * 60}ms`, '--mk-badge-tint': BADGE_COLORS[i].tint, '--mk-badge-ink': BADGE_COLORS[i].ink }}
                  key={f.title}
                >
                  <div className="mk-feature-icon">{f.icon}</div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* WHAT'S DIFFERENT, text + real app screenshot */}
        <section className="mk-section" style={{ paddingBottom: 24 }}>
          <div className="mk-section-inner mk-split-2" style={{ alignItems: 'center' }}>
            <Reveal>
              <div className="mk-warm-eyebrow">{HEART_ICON}Why practitioners like it</div>
              <h3>Nobody to wait on but yourself</h3>
              <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 12 }}>
                You already carry the hardest part of this work, showing up for kids and families. Izaya One just means the form that comes after doesn't sit on your desk, or anyone else's.
              </p>
              <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 10 }}>
                $19.99 a month, and everything's included: logging visits, building your forms, scheduling, video sessions, all of it, built for someone working on their own.
              </p>
              <div className="mk-warm-quote" style={{ marginTop: 22 }}>
                {SHIELD_ICON}
                <p>Your information is kept private and secure, the same way it is for every practitioner on Izaya, no matter who they work with.</p>
              </div>
            </Reveal>
            <Reveal>
              <div className="mk-phone-mockup">
                <div className="mk-phone-mockup-screen">
                  <img src={`${import.meta.env.BASE_URL}Pract_Dash.png`} alt="The Izaya One home screen, showing a practitioner's visits this month and a quick button to log a session" />
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="mk-section" style={{ paddingTop: 0 }}>
          <div className="mk-section-inner">
            <div className="mk-warm-cta">
              <div>
                <h2>Give yourself a lighter week</h2>
                <p>Try it free for 30 days. No card needed. You could log your first visit before your next appointment.</p>
              </div>
              <Link to={signupHref} className="mk-warm-btn-primary">Get started</Link>
            </div>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
