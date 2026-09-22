#!/usr/bin/env node
// Build-time prerenderer for the four public marketing routes served under
// izayaedge.com/eis/*. Run automatically after `vite build` (see the
// "build" script in package.json).
//
// Why this exists: /eis is otherwise a pure client-rendered SPA. The HTML
// Google's crawler fetches for it is just <title>Izaya EIS</title> and an
// empty <div id="root"></div> — all real content is injected by JavaScript
// after the bundle loads. That's the reason /eis never ranked in search
// while izayaedge.com's root domain (a separate, server-rendered Next.js
// app) did. This script renders each marketing page's real JSX to an HTML
// string at build time and writes it to its own static index.html, so the
// crawler's very first response already contains the actual headline, body
// copy, and per-page <title>/<meta description> — no JS execution required.
//
// Scope, deliberately narrow: only the four PUBLIC marketing routes below
// are prerendered. Everything else (/login, /dashboard, /admin-dashboard,
// /signup, etc.) is untouched and keeps working exactly as it does today —
// those are behind auth, shouldn't be indexed, and route through several
// providers (MessagingProvider, idle-logout, session listeners) that read
// localStorage/window at render time and are not SSR-safe. This script
// renders each marketing page directly against a minimal StaticRouter,
// bypassing App.jsx and those providers entirely, rather than trying to
// make the whole app SSR-safe.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { MARKETING_META } from '../src/seo/marketingMeta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BASE = '/eis';

// Marketing page components import .css (via MarketingLayout.jsx's
// @fontsource-variable/* and marketing.css side-effect imports), which
// plain Node ESM has no loader for. Loading them through a Vite dev server
// in middleware mode (ssrLoadModule) reuses Vite's own JSX/CSS transform
// pipeline instead of reimplementing it — Vite treats CSS imports as
// side-effect-only (no-op) under SSR, which is exactly the behavior we
// want here since the built page already links its real stylesheet.
const vite = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
});

const { default: Home } = await vite.ssrLoadModule('/src/pages/marketing/Home.jsx');
const { default: HowItWorks } = await vite.ssrLoadModule('/src/pages/marketing/HowItWorks.jsx');
const { default: PractitionerApp } = await vite.ssrLoadModule('/src/pages/marketing/PractitionerApp.jsx');
const { default: Contact } = await vite.ssrLoadModule('/src/pages/marketing/Contact.jsx');

const ROUTES = [
  { routePath: '/', Component: Home, outDir: '' },
  { routePath: '/how-it-works', Component: HowItWorks, outDir: 'how-it-works' },
  { routePath: '/download', Component: PractitionerApp, outDir: 'download' },
  { routePath: '/contact', Component: Contact, outDir: 'contact' },
];

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function injectHead(shellHtml, meta) {
  const canonical = `https://izayaedge.com${meta.path}`;
  const headExtras = `
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />`;

  // The built index.html still has vite's static <title>Izaya EIS</title>
  // from frontend/index.html — replace it rather than appending a second,
  // conflicting title tag.
  return shellHtml
    .replace(/<title>.*?<\/title>/s, '')
    .replace('</head>', `${headExtras}\n  </head>`);
}

function injectBody(shellHtml, bodyHtml) {
  // Vite's build output keeps the same <div id="root"></div> mount point;
  // fill it with the server-rendered markup so React can hydrate onto it
  // client-side instead of mounting into an empty node.
  return shellHtml.replace(
    '<div id="root"></div>',
    `<div id="root">${bodyHtml}</div>`
  );
}

async function main() {
  const shellPath = path.join(DIST, 'index.html');
  const shellHtml = await readFile(shellPath, 'utf8');

  // vercel.json's catch-all ("/(.*)" -> "/index.html") serves this same
  // file for every non-marketing route (/login, /dashboard, /signup, ...).
  // Once the loop below overwrites dist/index.html with the prerendered
  // homepage's real markup, that catch-all would start serving the
  // homepage's server-rendered content as the initial paint for /login
  // too — and main.jsx's hydrateRoot path would then try to hydrate the
  // login page's React tree against the homepage's stale DOM, a genuine
  // hydration mismatch in production. Save an untouched copy of the
  // original empty-shell build here, before any route overwrites
  // dist/index.html, and point the catch-all at that copy instead
  // (vercel.json's rewrite for "/(.*)" is updated to "/app.html").
  await writeFile(path.join(DIST, 'app.html'), shellHtml, 'utf8');

  for (const { routePath, Component, outDir } of ROUTES) {
    const meta = MARKETING_META[routePath];
    if (!meta) {
      throw new Error(`No SEO metadata configured for marketing route "${routePath}" — add an entry to src/seo/marketingMeta.js before prerendering it.`);
    }

    // StaticRouter's `location` must already include `basename` as a
    // prefix — passing the bare route path ("/how-it-works") alongside
    // basename "/eis" makes the router see a location that doesn't start
    // with its own basename, so it matches nothing and renders null. This
    // bit us during the first build (silently: no error, just empty output).
    const bodyHtml = renderToStaticMarkup(
      React.createElement(
        StaticRouter,
        { basename: BASE, location: `${BASE}${routePath === '/' ? '' : routePath}` },
        React.createElement(Component)
      )
    );

    let html = injectHead(shellHtml, meta);
    html = injectBody(html, bodyHtml);

    const targetDir = outDir ? path.join(DIST, outDir) : DIST;
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, 'index.html'), html, 'utf8');
    console.log(`prerendered ${meta.path} -> dist/${outDir ? outDir + '/' : ''}index.html`);
  }
}

main()
  .catch((err) => {
    console.error('[prerender] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => vite.close());
