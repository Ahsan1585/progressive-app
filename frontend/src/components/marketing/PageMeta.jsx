import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { MARKETING_META } from '../../seo/marketingMeta';

// The prerender script bakes correct <title>/<meta description> into each
// route's static HTML for the initial (crawler/first-load) response. But
// once the SPA has hydrated, React Router does client-side "soft"
// navigation between marketing pages without a full page reload — so
// without this, navigating from / to /how-it-works would keep showing "/"'s
// prerendered title forever. This keeps the document head in sync with
// whichever marketing route is actually showing after the first load.
function upsertMeta(name, content) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

export function PageMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    // pathname includes the router's basename (e.g. "/eis/how-it-works");
    // MARKETING_META is keyed by the route path relative to that basename.
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
    const key = relative === '' ? '/' : relative;
    const meta = MARKETING_META[key];
    if (!meta) return; // non-marketing route (dashboard, login, etc.) — leave head alone

    document.title = meta.title;
    upsertMeta('description', meta.description);
  }, [pathname]);

  return null;
}
