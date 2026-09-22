// Per-route <title>/<meta description>/Open Graph content for the public
// marketing pages, served under izayaedge.com/eis/*. Consumed by two
// places that must stay in sync with the route table in App.jsx's
// WEB_ROUTES: scripts/prerender.mjs (build-time static HTML generation)
// and, for the client-rendered navigation case (soft nav between marketing
// pages without a full page load), src/components/marketing/PageMeta.jsx.
//
// Before this file existed, every /eis* page shipped the same static
// "Izaya EIS" <title> baked into index.html with no description at all —
// the direct cause of /eis being invisible in Google search while the
// unrelated izayaedge.com root domain (a separate Next.js app with real
// per-page metadata) ranked instead.
const SITE_URL = 'https://izayaedge.com';

export const MARKETING_META = {
  '/': {
    title: 'Izaya EIS | NJ Early Intervention Billing Software',
    description:
      'Izaya EISimplified™ is the billing platform built for early intervention agencies. Practitioners log a session on their phone — the system handles validation, SEVF, and invoicing automatically.',
    path: '/eis',
  },
  '/how-it-works': {
    title: 'How It Works | Izaya EIS',
    description:
      'See how Izaya EIS turns a practitioner’s session log into a validated, error-free billing record — automatic validation, instant error correction, and SEVF/invoice generation.',
    path: '/eis/how-it-works',
  },
  '/download': {
    title: 'Download the Practitioner App | Izaya EIS',
    description:
      'Get the Izaya EIS practitioner app: log sessions in the field, capture signatures on the device, save drafts, and fix returned logs in seconds.',
    path: '/eis/download',
  },
  '/contact': {
    title: 'Schedule a Demo | Izaya EIS',
    description:
      'Talk to Izaya EIS about bringing automated billing, validation, and invoicing to your early intervention agency. Schedule a demo today.',
    path: '/eis/contact',
  },
};

export function absoluteUrl(routePath) {
  const entry = MARKETING_META[routePath];
  return `${SITE_URL}${entry ? entry.path : '/eis'}`;
}
