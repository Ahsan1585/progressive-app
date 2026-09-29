import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';

const FEATURES = [
  {
    title: 'Log sessions on your phone',
    body: 'Client, service, date, start and end time — captured in the field with a running total-time calculation and parent plus practitioner signatures, exactly like every other Izaya EIS practitioner.',
  },
  {
    title: 'Generate your own SEVF',
    body: 'No office to send your logs to and wait on. Certify your own sessions and generate the state-mandated service verification form yourself, split correctly by agency and by month.',
  },
  {
    title: 'Schedule appointments',
    body: 'Keep your own caseload and calendar in one place, with automatic reminders for families.',
  },
  {
    title: 'Telepractice, built in',
    body: 'Conduct a video session, then send the signature link straight to email — no printing, no paper trail.',
  },
  {
    title: 'Email your SEVF directly to an agency',
    body: 'Skip the mail. Once a SEVF is generated, send it straight to whichever early intervention agency you did the work for, right from the app.',
  },
  {
    title: 'Set up your own vocabulary',
    body: 'Disciplines, service types, and the agencies you bill to — all self-service, all yours to configure.',
  },
];

export default function Practitioners() {
  return (
    <MarketingLayout>
      <section className="mk-hero-band">
        <div className="mk-hero-band-inner">
          <div className="mk-eyebrow">For independent practitioners</div>
          <h1>Your company hasn't signed up with Izaya. You still can.</h1>
          <p className="mk-sub">
            Izaya EISimplified™ isn't just for agencies. If you're a practitioner working with early intervention agencies that haven't enrolled, you can register directly — log sessions, generate your own SEVFs, and bill the agencies you work with, all from the same practitioner app.
          </p>
          <div className="mk-home-hero-ctas" style={{ marginTop: 24 }}>
            <Link to="/signup/independent" className="mk-btn-primary">
              Sign up — $30/month
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
            </Link>
            <Link to="/download" className="mk-btn-text">Download the practitioner app</Link>
          </div>
          <p className="mk-home-hero-note">15-day free trial. No card required to start.</p>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-section-inner">
          <div className="mk-eyebrow">Same app, built for you</div>
          <h2 style={{ marginBottom: 28 }}>Everything a tenant-registered practitioner gets — adapted for working independently</h2>
          <div className="mk-steps mk-steps-2col">
            {FEATURES.map((f) => (
              <div className="mk-step-card" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-alt">
        <div className="mk-section-inner mk-split-2">
          <div>
            <div className="mk-eyebrow">What's different</div>
            <h3>No office. No invoice. No problem.</h3>
            <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 12 }}>
              A tenant-registered practitioner's logs go to their company's billing team for review, who issue an invoice for the practitioner's pay. As an independent practitioner, you certify your own sessions directly — no review queue, no waiting — and instead of an invoice, you generate the SEVF your agencies need for reimbursement.
            </p>
            <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 10 }}>
              You pay Izaya directly, $30/month, instead of your billing running through a company's subscription. Everything else — validation, signatures, scheduling, telepractice — works exactly the same.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="mk-card" style={{ border: '1px solid var(--mk-line)', borderRadius: 16, padding: 22 }}>
              <h3>SEVF, split correctly</h3>
              <p>One child, one SEVF — and if the same child's sessions are billed to more than one agency, or span more than one month, each gets its own form automatically.</p>
            </div>
            <div className="mk-card" style={{ border: '1px solid var(--mk-line)', borderRadius: 16, padding: 22 }}>
              <p style={{ margin: 0 }}>HIPAA-compliant and security-first, same as every Izaya EIS account. You accept your own Business Associate Agreement directly with Izaya at signup.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-section-inner">
          <div className="mk-cta-band">
            <div>
              <h2>Start your free trial</h2>
              <p>15 days, no card required. Set up in a few minutes.</p>
            </div>
            <Link to="/signup/independent" className="mk-btn-primary">Sign up</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
