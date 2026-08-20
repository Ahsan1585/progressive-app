import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';
import { MOBILE_APP_INSTALL_URL } from '../../components/AuthLayout';

const QR_HOST = new URL(MOBILE_APP_INSTALL_URL).host;

const IN_APP_FEATURES = [
  { title: 'Log sessions in the field', body: 'Client, service, date, and times with a live total-time calculation.' },
  { title: 'Capture signatures', body: 'Parent and practitioner signatures on the device, with a reusable saved signature.' },
  { title: 'Save drafts', body: 'Start a log between visits and finish it later without losing anything.' },
  { title: 'Fix returned logs', body: 'See exactly what was flagged, correct it, and resubmit in seconds.' },
  { title: 'Message the office', body: 'Talk to your billing team in the app instead of chasing email threads.' },
];

function InstallQR() {
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
    <div className="mk-qr-tile">
      <div className="mk-qr" aria-label={`QR code linking to ${QR_HOST}`}>
        {failed ? (
          <span style={{ fontSize: 12, color: 'var(--mk-slate)' }}>Visit<br /><b>{QR_HOST}</b><br />on your phone</span>
        ) : (
          <canvas ref={canvasRef} width={184} height={184} />
        )}
      </div>
      <div className="mk-qr-label">Scan with your phone</div>
    </div>
  );
}

export default function PractitionerApp() {
  return (
    <MarketingLayout>
      <section className="mk-hero-band">
        <div className="mk-hero-band-inner">
          <div className="mk-eyebrow">Practitioner app</div>
          <h1>Install Izaya EISimplified on your phone</h1>
          <p className="mk-sub">
            The practitioner app installs straight from your browser to your home screen. No app store account, no download queue, no IT ticket.
          </p>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-section-inner mk-download-grid">
          <InstallQR />
          <div>
            <div className="mk-eyebrow">Two ways in</div>
            <h2 style={{ fontSize: 'clamp(22px, 2.6vw, 30px)', marginBottom: 12 }}>Scan the code, or open the link</h2>
            <p style={{ fontSize: 14, color: 'var(--mk-body)', lineHeight: 1.6, marginBottom: 20 }}>
              Point your phone camera at the QR code, or tap the button below if you're already reading this on the device you'll use for sessions. Then follow the install steps for your phone.
            </p>
            <div className="mk-download-actions">
              <a href={MOBILE_APP_INSTALL_URL} target="_blank" rel="noopener noreferrer" className="mk-btn-primary">
                Open the app
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14L21 3" /></svg>
              </a>
              <Link to="/signup" className="mk-btn-text">Need an account?</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section mk-alt">
        <div className="mk-section-inner">
          <div className="mk-section-head mk-center">
            <div className="mk-eyebrow">Add to home screen</div>
            <h2>Install steps for your phone</h2>
          </div>
          <div className="mk-install-steps">
            <div>
              <h3>iPhone &amp; iPad (Safari)</h3>
              <ol>
                <li><span className="mk-sn">1</span>Open the app link in Safari on your iPhone or iPad.</li>
                <li><span className="mk-sn">2</span>Tap the Share button at the bottom of the screen.</li>
                <li><span className="mk-sn">3</span>Scroll down and tap "Add to Home Screen".</li>
                <li><span className="mk-sn">4</span>Tap "Add" — the Izaya EISimplified icon appears with your other apps.</li>
              </ol>
            </div>
            <div>
              <h3>Android (Chrome)</h3>
              <ol>
                <li><span className="mk-sn">1</span>Open the app link in Chrome on your Android phone.</li>
                <li><span className="mk-sn">2</span>Tap the three-dot menu in the top right.</li>
                <li><span className="mk-sn">3</span>Tap "Install app" (or "Add to Home screen").</li>
                <li><span className="mk-sn">4</span>Confirm — the app installs to your home screen.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-section-inner">
          <div className="mk-section-head mk-center">
            <div className="mk-eyebrow">In the app</div>
            <h2>Everything a practitioner needs, nothing they don't</h2>
          </div>
          <div className="mk-cards-5">
            {IN_APP_FEATURES.map((f) => (
              <div className="mk-card" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-app-cta">
        <div className="mk-app-cta-inner">
          <p style={{ maxWidth: 480 }}>Not using Izaya EISimplified yet? See what your billing cycle looks like without the paperwork.</p>
          <Link to="/contact" className="mk-btn-primary">Schedule a demo</Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
