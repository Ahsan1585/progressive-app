import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';

const STEPS = [
  {
    n: 1,
    title: 'Practitioner logs the session on their phone',
    body: 'Client, service, date, start and end time — captured in the field with a running total-time calculation and parent plus practitioner signatures.',
    tag: 'Quick. Easy. Done.',
  },
  {
    n: 2,
    title: 'The system validates automatically',
    body: 'Required fields, service codes, signatures, time rules, and duplicate logs are all checked the moment the session is submitted.',
    tag: 'Built-in smart validations.',
  },
  {
    n: 3,
    title: "If errors are found, they're returned in the platform",
    body: 'Missing signature, invalid service code, incorrect end time — the practitioner sees exactly what to fix, right where they work.',
    tag: 'Instant return. No emails. No calls.',
  },
  {
    n: 4,
    title: 'The practitioner corrects instantly',
    body: 'Open the returned log, fix the flagged field, re-sign if needed, and resubmit — usually in under a minute.',
    tag: 'Correct in seconds and resubmit.',
  },
  {
    n: 5,
    title: 'All logs are error-free',
    body: 'Clean logs are auto-approved. Your billing team never touches a session that had nothing wrong with it.',
    tag: '100% clean logs. Ready to go.',
  },
  {
    n: 6,
    title: 'SEVF and invoice are generated automatically',
    body: 'Units, rates, totals, and the state-mandated service verification form are produced from the approved logs — no re-keying, no spreadsheets.',
    tag: 'Total time and amount calculated automatically.',
  },
];

export default function HowItWorks() {
  return (
    <MarketingLayout>
      <section className="mk-hero-band">
        <div className="mk-hero-band-inner">
          <div className="mk-eyebrow">How it works</div>
          <h1>From a session on a phone to a finished invoice</h1>
          <p className="mk-sub">
            Izaya EISimplified™ follows one continuous path. Practitioners log in the field, the platform validates and routes exceptions, and finished billing documents come out the other end.
          </p>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-section-inner">
          <div className="mk-steps mk-steps-2col">
            {STEPS.map((s) => (
              <div className="mk-step-card" key={s.n}>
                <div className="mk-step-num">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <div className="mk-step-tag">{s.tag}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-alt">
        <div className="mk-section-inner mk-split-2">
          <div>
            <div className="mk-eyebrow">Exception-based review</div>
            <h3>Your billing team only sees what's actually broken</h3>
            <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 12 }}>
              Traditional early intervention billing means reviewing every single log to find the handful that are wrong. Izaya EISimplified™ inverts that. Clean logs approve themselves. Flagged logs are returned to the practitioner inside the platform, with a comment, and come back corrected. Nothing sits in an inbox waiting for a reply.
            </p>
            <p style={{ fontSize: 16, color: 'var(--mk-body)', lineHeight: 1.6, marginTop: 10 }}>
              The result is a review queue that shrinks to exceptions only — and a billing cycle that closes in a fraction of the time.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="mk-card" style={{ border: '1px solid var(--mk-line)', borderRadius: 16, padding: 22 }}>
              <h3>SEVF, generated for you</h3>
              <p>Provider, NPI, service month, and every code, unit, rate, and amount are filled in from the approved logs and signed off — ready for submission.</p>
            </div>
            <div className="mk-card" style={{ border: '1px solid var(--mk-line)', borderRadius: 16, padding: 22 }}>
              <h3>Invoices, calculated to the cent</h3>
              <p>Invoice number, issue and due date, line items, and total amount are produced from the same source data — so the form and the invoice can never disagree.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-section-inner">
          <div className="mk-cta-band">
            <div>
              <h2>See it with your own logs</h2>
              <p>We'll walk your team through the full flow in about 30 minutes.</p>
            </div>
            <Link to="/contact" className="mk-btn-primary">Schedule a demo</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
