import { useState } from 'react';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';
import api from '@/api/axiosInstance';

const MAIL_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4z" /><path d="M22 6l-10 7L2 6" /></svg>;

export default function Contact() {
  const [form, setForm] = useState({
    fullName: '', workEmail: '', agencyName: '', practitionerCount: '', message: '',
  });
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const [error, setError] = useState('');

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('submitting');
    setError('');
    try {
      await api.post('/api/contact', form);
      setStatus('success');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  return (
    <MarketingLayout>
      <section className="mk-hero-band">
        <div className="mk-hero-band-inner">
          <div className="mk-eyebrow">Schedule a demo</div>
          <h1>Let us show you the workflow</h1>
          <p className="mk-sub">
            Tell us a little about your agency and we'll set up a 30-minute walkthrough of Izaya EISimplified™ — session logging, exception review, SEVF, and invoicing.
          </p>
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 40 }}>
        <div className="mk-section-inner mk-contact-grid">
          <div className="mk-contact-form">
            {status === 'success' ? (
              <div className="mk-form-banner mk-success">
                Thanks — we've received your request and will be in touch shortly.
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                {status === 'error' && <div className="mk-form-banner mk-error">{error}</div>}
                <div className="mk-form-row">
                  <div className="mk-field">
                    <label htmlFor="contact-name">Full name *</label>
                    <input id="contact-name" type="text" value={form.fullName} onChange={update('fullName')} required />
                  </div>
                  <div className="mk-field">
                    <label htmlFor="contact-email">Work email *</label>
                    <input id="contact-email" type="email" value={form.workEmail} onChange={update('workEmail')} required />
                  </div>
                </div>
                <div className="mk-field">
                  <label htmlFor="contact-agency">Agency / company *</label>
                  <input id="contact-agency" type="text" value={form.agencyName} onChange={update('agencyName')} required />
                </div>
                <div className="mk-field">
                  <label htmlFor="contact-count">How many practitioners?</label>
                  <input id="contact-count" type="text" placeholder="e.g. 25" value={form.practitionerCount} onChange={update('practitionerCount')} />
                </div>
                <div className="mk-field">
                  <label htmlFor="contact-message">What would you like to see?</label>
                  <textarea id="contact-message" placeholder="Tell us about your current billing process and where it slows down" value={form.message} onChange={update('message')} />
                </div>
                <button type="submit" className="mk-btn-primary" disabled={status === 'submitting'} style={{ width: '100%', justifyContent: 'center' }}>
                  {status === 'submitting' ? 'Sending…' : 'Send request'}
                </button>
              </form>
            )}
          </div>

          <div className="mk-contact-direct">
            <h3>Talk to us directly</h3>
            <p>Email us anytime — we're happy to answer questions about compliance, onboarding, or how Izaya EISimplified™ fits alongside your current systems.</p>
            <div className="mk-contact-direct-list">
              <div className="mk-contact-direct-item">{MAIL_ICON}<a href="mailto:support@izayaedge.com">support@izayaedge.com</a></div>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
