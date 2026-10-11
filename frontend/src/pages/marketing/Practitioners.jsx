import { Link, useSearchParams } from 'react-router-dom';
import {
  Smartphone, FileCheck2, ShieldCheck, CalendarDays, Video, Users,
  ArrowRight, Check, ChevronDown,
} from 'lucide-react';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { IZAYA_ONE_INSTALL_URL } from '../../components/AuthLayout';

const SIGNUP_URL = '/signup/independent';

const WORKFLOW_STEPS = [
  {
    icon: Smartphone,
    title: 'Log your session',
    body: 'Record a session from your phone. No piles of notes. No entering the same details twice.',
  },
  {
    icon: FileCheck2,
    title: "Get the parent's signature",
    body: 'On your phone in person, or on theirs when you meet remotely.',
  },
  {
    icon: ArrowRight,
    title: 'Generate. Send. Move on.',
    body: 'Turn your logged sessions into SEVFs and invoices, with hours and amounts calculated automatically.',
  },
];

const FEATURES = [
  {
    icon: Users,
    title: 'Unlimited sessions & children',
    body: 'Unlimited children, sessions, and agencies. One place to keep it all.',
  },
  {
    icon: CalendarDays,
    title: 'A clearer calendar',
    body: 'Your families and appointments together, with helpful reminders.',
  },
  {
    icon: Video,
    title: 'Built-in video sessions',
    body: 'Parents sign right on your phone, or remotely for telehealth. Keep the session moving.',
  },
  {
    icon: ShieldCheck,
    title: 'Ready for each agency',
    body: 'Separate SEVFs and invoices for every company you work with.',
  },
];

const PRICING_INCLUDES = [
  'Mobile session logging',
  'Automatic SEVFs',
  'Automatic invoices',
  'Parent signatures',
  'Scheduling & reminders',
  'Telehealth, built in',
  'Multiple agencies',
  'Unlimited everything',
];

const FAQS = [
  {
    q: 'What is included in $19.99 a month?',
    a: 'Session logging, automatic SEVFs and invoices, parent signatures, your calendar, and video sessions are included. Keep your children, sessions, and agencies together with no extra charge for working with more agencies.',
  },
  {
    q: 'What happens during my free trial?',
    a: 'You can try Izaya One free for 30 days, with no credit card required to start. Explore session logging, forms, signatures, scheduling, and video sessions before deciding whether it fits your work.',
  },
  {
    q: 'Do I need to enter a credit card?',
    a: 'No. You can start your 30-day free trial without entering a credit card.',
  },
  {
    q: 'Can I work with multiple agencies?',
    a: 'Yes. Add the agencies you work with and keep each company’s SEVFs and invoices separate. Your monthly rate is flat, no matter how many agencies you work with.',
  },
  {
    q: 'Can parents sign for a telehealth session?',
    a: 'Yes. Video sessions are built in, and parents can sign remotely from their own phone.',
  },
  {
    q: 'Who is Izaya One for?',
    a: 'Izaya One is built for independent early intervention practitioners, including occupational therapists, physical therapists, speech-language pathologists, developmental interventionists, social workers, and translators.',
  },
];

function Reveal({ as: Tag = 'div', className = '', style, children }) {
  const ref = useScrollReveal();
  return (
    <Tag ref={ref} className={`mk-reveal ${className}`} style={style}>
      {children}
    </Tag>
  );
}

function FaqItem({ q, a }) {
  return (
    <details className="lv-faq-item">
      <summary>
        {q}
        <ChevronDown className="lv-faq-chevron" size={18} />
      </summary>
      <p>{a}</p>
    </details>
  );
}

export default function Practitioners() {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');
  const signupHref = refCode ? `${SIGNUP_URL}?ref=${encodeURIComponent(refCode)}` : SIGNUP_URL;

  return (
    <MarketingLayout isOne>
      <div className="lv-page">
        {/* HERO */}
        <section className="lv-hero">
          <img
            className="lv-hero-photo"
            src={`${import.meta.env.BASE_URL}lovable-hero-photo.jpg`}
            alt="An early intervention practitioner in scrubs, smiling at her phone while logging a session"
          />
          <div className="lv-wrap lv-hero-content">
            <span className="lv-eyebrow">For independent practitioners</span>
            <h1 className="lv-hero-title">
              Your sessions.<br /><span>Not your paperwork.</span>
            </h1>
            <p className="lv-hero-lead">
              One session log. Automatic SEVFs and invoices.<br />
              Parent signatures. All from your phone.
            </p>
            <div className="lv-hero-actions">
              <Link to={signupHref} className="lv-btn lv-btn-trial">
                Start my 30-day free trial
                <ArrowRight size={18} />
              </Link>
              <a href="#how-it-works" className="lv-btn lv-btn-outline">
                See how it works
                <ArrowRight size={18} />
              </a>
            </div>
            <div className="lv-hero-notes">
              <span><Check size={13} />30 days free</span>
              <span><Check size={13} />No credit card</span>
              <span><Check size={13} />Everything included</span>
            </div>
            <div className="lv-hero-value">
              <span className="lv-hero-price">$19.99<small>/ month</small></span>
              <span className="lv-hero-price-caption">
                After your trial.<br />Every feature. Every agency. One price.
              </span>
            </div>
          </div>
        </section>

        {/* VALUE STRIP */}
        <section className="lv-value-strip">
          <div className="lv-wrap lv-value-strip-inner">
            <div>
              <h3>Log once. From your phone.</h3>
              <p>Add the child, session time, and notes while everything is still fresh.</p>
            </div>
            <div>
              <h3>Forms &amp; invoices. Made automatically.</h3>
              <p>Your SEVFs and invoices are calculated and organized by agency, ready to send.</p>
            </div>
            <div>
              <h3>Unlimited everything. One flat price.</h3>
              <p>All the essentials included. Not sold separately.</p>
            </div>
          </div>
        </section>

        {/* WORKFLOW / HOW IT WORKS */}
        <section className="lv-section lv-workflow" id="how-it-works">
          <div className="lv-wrap">
            <Reveal as="div" className="lv-section-head">
              <h2 className="lv-section-title">From a logged session to &ldquo;all taken care of.&rdquo;</h2>
              <p className="lv-section-copy">From the last minute of a session to the last form of the month.</p>
            </Reveal>
            <div className="lv-workflow-grid">
              {WORKFLOW_STEPS.map((s, i) => (
                <Reveal as="div" className="lv-workflow-step" style={{ transitionDelay: `${i * 70}ms` }} key={s.title}>
                  <span className="lv-step-number">{i + 1}</span>
                  <div className="lv-feature-icon"><s.icon size={20} strokeWidth={1.8} /></div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </Reveal>
              ))}
            </div>
            <Reveal className="lv-dashboard-shot">
              <img
                src={`${import.meta.env.BASE_URL}lovable-dashboard.png`}
                alt="The Izaya One home screen, showing sessions this month, hours, amount invoiced, and a quick button to log a session"
              />
            </Reveal>
          </div>
        </section>

        {/* FEATURES */}
        <section className="lv-section">
          <div className="lv-wrap">
            <Reveal as="div" className="lv-section-head">
              <h2 className="lv-section-title">Your work matters. Your time does, too.</h2>
              <p className="lv-section-copy">Not another tool to juggle. Everything an independent practitioner needs, in one simple app.</p>
            </Reveal>
            <div className="lv-feature-grid">
              {FEATURES.map((f, i) => (
                <Reveal as="div" className="lv-feature-card" style={{ transitionDelay: `${i * 60}ms` }} key={f.title}>
                  <div className="lv-feature-icon"><f.icon size={20} strokeWidth={1.8} /></div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section className="lv-pricing-band">
          <div className="lv-wrap">
            <Reveal as="div" className="lv-pricing-inner">
              <div className="lv-pricing-head">
                <h2 className="lv-section-title">We take care of the paperwork.</h2>
                <p className="lv-section-copy">For less than $20 a month, bring your sessions, signatures, forms, invoices, and schedule into one simple app.</p>
                <div className="lv-pricing-price">
                  <span>$19.99</span>
                  <small>/ month, after your free 30-day trial</small>
                </div>
                <Link to={signupHref} className="lv-btn lv-btn-trial">
                  Start my 30-day free trial
                  <ArrowRight size={18} />
                </Link>
                <p className="lv-pricing-foot">No credit card required</p>
              </div>
              <ul className="lv-pricing-list">
                {PRICING_INCLUDES.map((item) => (
                  <li key={item}><Check size={16} />{item}</li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* FAQ */}
        <section className="lv-section">
          <div className="lv-wrap lv-faq-wrap">
            <Reveal as="div" className="lv-section-head">
              <h2 className="lv-section-title">Good questions. Simple answers.</h2>
            </Reveal>
            <Reveal className="lv-faq-list">
              {FAQS.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
            </Reveal>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="lv-section lv-final-cta">
          <div className="lv-wrap">
            <Reveal as="div" className="lv-final-cta-inner">
              <h2>30 days to see the difference for yourself.</h2>
              <p>With less on your plate.</p>
              <div className="lv-final-cta-actions">
                <Link to={signupHref} className="lv-btn lv-btn-trial">
                  Start my 30-day free trial
                  <ArrowRight size={18} />
                </Link>
                <a href={IZAYA_ONE_INSTALL_URL} target="_blank" rel="noopener noreferrer" className="lv-btn lv-btn-outline-dark">
                  Get the app
                </a>
              </div>
              <p className="lv-final-cta-note">30 days free &middot; No card required &middot; Then $19.99/month</p>
            </Reveal>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
