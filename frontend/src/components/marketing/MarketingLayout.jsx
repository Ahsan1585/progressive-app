import { useState } from 'react';
// Self-hosted (not the Google Fonts CDN) — this app's CSP is script/style
// 'self'-only, so an external fonts.googleapis.com <link> silently fails to
// load. Same pattern the old landing page used.
import '@fontsource-variable/sora';
import '@fontsource-variable/manrope';
import '../../styles/marketing.css';
import { MOBILE_APP_INSTALL_URL } from '../AuthLayout';
import { MarketingNav } from './MarketingNav';
import { MarketingFooter } from './MarketingFooter';

const MOBILE_BANNER_SEEN_KEY = 'izaya-mobile-install-banner-seen';

export function MarketingLayout({ children }) {
  const [showMobileInstallBanner, setShowMobileInstallBanner] = useState(() => {
    try {
      const isPhoneViewport = window.matchMedia('(max-width: 767px)').matches;
      const alreadySeen = localStorage.getItem(MOBILE_BANNER_SEEN_KEY) === 'true';
      return isPhoneViewport && !alreadySeen;
    } catch {
      return false;
    }
  });

  const dismissMobileInstallBanner = () => {
    setShowMobileInstallBanner(false);
    try { localStorage.setItem(MOBILE_BANNER_SEEN_KEY, 'true'); } catch { /* ignore */ }
  };

  return (
    <div className="mk-page">
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />

      {showMobileInstallBanner && (
        <div className="mk-mobile-banner" role="dialog" aria-label="Install the Izaya app">
          <span className="mk-mobile-banner-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
          </span>
          <div className="mk-mobile-banner-text">
            <div className="t1">Install the Izaya app</div>
            <div className="t2">Faster access, right from your home screen</div>
          </div>
          <a
            href={MOBILE_APP_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mk-mobile-banner-cta"
            onClick={dismissMobileInstallBanner}
          >
            Install
          </a>
          <button
            type="button"
            className="mk-mobile-banner-close"
            onClick={dismissMobileInstallBanner}
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
