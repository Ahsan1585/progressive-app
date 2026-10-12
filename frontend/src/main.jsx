import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// A #hash left in the URL from an earlier in-app nav click (e.g. the
// Practitioners page's "How it works"/"Practitioner app" anchors) means a
// reload, bookmark, or shared link of that URL would otherwise land
// scrolled down instead of at the top — the browser's own native
// fragment-scroll jumps to that element as soon as it parses the
// prerendered HTML, before React (and App.jsx's in-app ScrollToTop logic)
// ever runs. Stripping the hash here, as early as possible and before any
// rendering, is what actually wins that race; App.jsx's ScrollToTop only
// has to handle hash changes from subsequent in-app navigation.
if (window.location.hash) {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  window.scrollTo(0, 0);
}

// The four public marketing routes (/, /how-it-works, /download, /contact
// under the /eis base) are prerendered at build time (scripts/prerender.mjs)
// so crawlers get real HTML instead of an empty shell — see that script's
// header comment for why. Every other route (login, dashboard, signup,
// etc.) still ships the original empty `<div id="root"></div>` and must be
// mounted fresh with createRoot; hydrateRoot on a truly empty node throws,
// since there's no server-rendered markup for it to reconcile against.
const rootEl = document.getElementById('root');
const hasPrerenderedContent = rootEl.firstElementChild !== null;

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

if (hasPrerenderedContent) {
  hydrateRoot(rootEl, app);
} else {
  createRoot(rootEl).render(app);
}
