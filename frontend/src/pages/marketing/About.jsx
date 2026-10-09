import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';

const TARGET_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>;
const MAP_PIN_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
const ROCKET_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.8-.8 1-2.2.2-3.1a2.2 2.2 0 0 0-3.1.2Z" /><path d="M12 15l-3-3a22 22 0 0 1 6.74-8.19 2.5 2.5 0 0 1 3.45 3.45A22 22 0 0 1 12 15Z" /><path d="M9 12l-2-2" /><path d="M14.5 6.5l3 3" /></svg>;
const PHONE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>;
const FILE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>;
const SHIELD_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5.5 3.4 9.7 8 11 4.6-1.3 8-5.5 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
const BUILDING_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" /></svg>;
const USER_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>;

const WHAT_WE_DO = [
  { icon: PHONE_ICON, title: 'Session logging in the field', body: 'Practitioners log each visit right from their phone, right after the session: client, service, date, start and end time, with signatures captured on the spot.' },
  { icon: SHIELD_ICON, title: 'Automatic validation', body: 'The moment a log is submitted, we check it for required fields, service codes, signatures, time rules, and duplicates, before it ever reaches a billing queue.' },
  { icon: FILE_ICON, title: 'SEVF and invoice generation', body: 'Approved logs turn into New Jersey\'s state-required Service Verification Form and a matching invoice automatically, with units, rates, and totals calculated for you.' },
];

const WHO_WE_SERVE = [
  { icon: BUILDING_ICON, title: 'Early intervention agencies', body: 'If you manage a team of practitioners, Izaya EIS handles session logging, exception review, compliance, SEVF generation, and invoicing for your whole caseload in one place.' },
  { icon: USER_ICON, title: 'Independent practitioners', body: 'If you bill early intervention agencies directly, without a company of your own, Izaya EIS lets you log your own sessions and generate your own SEVFs and invoices.' },
];

export default function About() {
  return (
    <MarketingLayout>
      <section className="mk-hero-band">
        <div className="mk-hero-band-inner">
          <div className="mk-eyebrow">About Izaya EIS</div>
          <h1>Built in New Jersey, for New Jersey's early intervention community</h1>
          <p className="mk-sub">
            Izaya EIS is a startup based in Central New Jersey. We build billing and compliance software for early intervention agencies and the practitioners who work with them every day.
          </p>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-section-inner mk-split-2">
          <div>
            <div className="mk-eyebrow">Why we started</div>
            <h3>Too much of the work was paperwork, not practice</h3>
            <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 12 }}>
              Early intervention professionals do incredible work, but too much of their day is consumed by administrative tasks that keep them away from the children they serve. Between session logs, compliance checks, and billing, a frustrating amount of time is lost to manual, repetitive paperwork.
            </p>
            <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 10 }}>
              We built Izaya to help carry that load. By automating data validation, SEVF generation, and invoicing, our goal is simple: give agencies and practitioners their time back, so they can focus on what they do best.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="mk-card" style={{ border: '1px solid var(--mk-line)', borderRadius: 16, padding: 22 }}>
              <div className="mk-feature-icon">{TARGET_ICON}</div>
              <h3>Purpose-built for early intervention</h3>
              <p>Izaya EIS is built specifically for New Jersey's Early Intervention System and the paperwork it requires, not adapted from a generic practice-management tool.</p>
            </div>
            <div className="mk-card" style={{ border: '1px solid var(--mk-line)', borderRadius: 16, padding: 22 }}>
              <div className="mk-feature-icon">{MAP_PIN_ICON}</div>
              <h3>Based in Central New Jersey</h3>
              <p>We're a New Jersey startup, built close to the agencies and practitioners we work with.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section mk-alt">
        <div className="mk-section-inner">
          <div className="mk-section-head mk-center">
            <div className="mk-eyebrow">What we do</div>
            <h2>One platform for the whole early intervention billing cycle</h2>
          </div>
          <div className="mk-feature-grid" style={{ marginTop: 8 }}>
            {WHAT_WE_DO.map((f) => (
              <div className="mk-feature-card" key={f.title}>
                <div className="mk-feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-section-inner">
          <div className="mk-section-head mk-center">
            <div className="mk-eyebrow">Who we serve</div>
            <h2>Built for both sides of New Jersey's Early Intervention System</h2>
          </div>
          <div className="mk-feature-grid" style={{ marginTop: 8, gridTemplateColumns: 'repeat(2, 1fr)', maxWidth: 760, marginLeft: 'auto', marginRight: 'auto' }}>
            {WHO_WE_SERVE.map((f) => (
              <div className="mk-feature-card" key={f.title}>
                <div className="mk-feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-alt">
        <div className="mk-section-inner">
          <div className="mk-section-head mk-center">
            <div className="mk-eyebrow">Our story</div>
            <h2>From an idea to a platform built for every day</h2>
          </div>
          <div className="mk-split-2" style={{ alignItems: 'center', marginTop: 8 }}>
            <div>
              <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6 }}>
                Izaya Consulting LLC started with a simple goal: build better software for New Jersey's early intervention community, agencies and the practitioners who do the hands-on work with children and families.
              </p>
              <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 10 }}>
                That work became Izaya EIS, short for Izaya Early Intervention Simplified. We launched it in the <b style={{ color: 'var(--mk-navy)' }}>summer of 2025</b>, built so agencies and independent practitioners across New Jersey can log sessions from the field, generate their state-required paperwork automatically, and manage billing in one place.
              </p>
              <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 10 }}>
                Today, we support both registered early intervention agencies and independent practitioners managing their own caseload, each with a version of Izaya EIS built around how they actually work.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="mk-card" style={{ border: '1px solid var(--mk-line)', borderRadius: 16, padding: 22, background: '#fff' }}>
                <div className="mk-feature-icon">{ROCKET_ICON}</div>
                <h3>Launched summer 2025</h3>
                <p>Izaya EIS went live in the summer of 2025 and is available for agencies and independent practitioners across New Jersey.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-section-inner">
          <div className="mk-cta-band">
            <div>
              <h2>See Izaya EIS for your agency</h2>
              <p>We'll walk your team through the full workflow in about 30 minutes.</p>
            </div>
            <Link to="/contact" className="mk-btn-primary">Schedule a demo</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
