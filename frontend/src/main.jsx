import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

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
