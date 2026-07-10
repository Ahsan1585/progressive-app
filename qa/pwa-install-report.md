# QA Report: PWA-enable `mobile/` + install banner on `frontend/` Login

Plan reference: `C:\Users\ahsan\.claude\plans\piped-swimming-origami.md`
Date: 2026-07-09

## Method

- `mobile/`: ran `npm run build` (production build, `tsc -b && vite build`), served
  `mobile/dist` with `vite preview` on `http://localhost:4173`, and drove it with a
  scripted Playwright (Chromium) session (manifest fetch, icon fetches, service-worker
  registration check across a reload).
- `frontend/`: built twice —
  1. `npm run build` with `VITE_MOBILE_APP_URL` unset (current committed state, `frontend/.env`
     has no such var) → served on `http://localhost:4174`.
  2. `VITE_MOBILE_APP_URL="https://example.com" npx vite build --outDir dist-with-banner`
     (temporary, build-command-only env var — nothing written to any tracked file, and the
     `dist-with-banner/` output directory was deleted after the test; `git status` confirms
     no stray artifacts remain) → served on `http://localhost:4175`.
  Drove both with scripted Playwright (Chromium) sessions using `browser.newContext()` with
  spoofed `userAgent`/`viewport`/`isMobile`/`hasTouch` to emulate Android/Chrome, iOS/Safari,
  and plain desktop Chrome.
- No MCP Playwright browser tools were available in this session's toolset, so I drove
  Chromium directly via small Node scripts using the `playwright` package (installed in an
  isolated scratch directory, not added to the repo) — same underlying engine/APIs
  (`browser_navigate`/`browser_snapshot`/`browser_evaluate` equivalents), just invoked
  programmatically rather than through MCP tool calls.
- Screenshots saved to `qa/`: `pwa-mobile-loaded.png`, `pwa-login-no-banner.png`,
  `pwa-login-android.png`, `pwa-login-ios-before-click.png` (iOS instructions dialog open),
  `pwa-login-desktop.png`.

## A. `mobile/` PWA installability

### A1. Production build succeeds and includes PWA artifacts — PASS
`npm run build` in `mobile/` completed successfully and produced:
```
dist/manifest.webmanifest
dist/sw.js
dist/workbox-9c191d2f.js
dist/registerSW.js
```
(PWA v1.3.0 plugin log: "precache 24 entries (635.54 KiB)").

### A2. Manifest resolves, is valid, SW registers, icons all 200 — PASS
- `<link rel="manifest">` resolves to `/manifest.webmanifest`, HTTP 200, valid JSON:
  ```json
  {
    "name": "Progressive Steps NJ — Practitioner",
    "short_name": "PS NJ",
    "display": "standalone",
    "start_url": "/", "scope": "/",
    "theme_color": "#2563eb", "background_color": "#f8fafc",
    "icons": [ ...192, 512, 512-maskable... ]
  }
  ```
  Contains `name`, `icons`, and `display: "standalone"` as required.
- All 3 manifest icon URLs (`/icons/icon-192.png`, `/icons/icon-512.png`,
  `/icons/icon-512-maskable.png`) returned HTTP 200. `apple-touch-icon` link
  (`/icons/apple-touch-icon.png`) also returned 200.
- Service worker: `navigator.serviceWorker.getRegistrations()` showed `sw.js` registered
  before reload; after a full page reload, `navigator.serviceWorker.controller.scriptURL`
  was `http://localhost:4173/sw.js` (non-null controller = SW is actively controlling the
  page, the standard installability signal).
- Zero console errors, zero failed (>=400) network requests during the whole session.

### A3. Screenshot of app loading post-build — PASS
`qa/pwa-mobile-loaded.png` — practitioner login screen (blue "PS" monogram icon,
"Progressive Steps NJ · Practitioner") rendered correctly from the production build.

## B. `frontend/` login page install banner

### B1. Env var unset → banner absent, no regression — PASS
With `VITE_MOBILE_APP_URL` unset (current repo state), the built Login page:
- Did **not** contain "install our mobile app", "Install App", "Add to Home Screen", or
  "Open the app" anywhere in the rendered DOM text (checked via `document.body.innerText`,
  not a source grep).
- Email input, password input, and Sign-In button all present and rendered normally.
- Zero console errors.
- Screenshot: `qa/pwa-login-no-banner.png`.

### B2. Env var set to `https://example.com` — platform-specific CTAs

**Android/Chrome (Pixel-7-class UA, `isMobile`/`hasTouch` true) — FIXED (see addendum below)**

> **Addendum (2026-07-09): fixed.** The root cause described below (cross-origin
> `beforeinstallprompt` capture is architecturally impossible) has been addressed by
> relocating the real native-install-prompt capture to where it can actually work:
> - `frontend/src/hooks/useInstallPrompt.js` (the dead-end cross-origin capture) has been
>   **deleted**. `frontend/src/components/InstallAppBanner.jsx` no longer attempts to
>   capture `beforeinstallprompt` at all; its Android/Chrome path now shows the "Open the
>   app →" link with an Android-specific note ("You'll be prompted to install it once
>   you're there - look for 'Install app' in Chrome"), setting accurate expectations
>   instead of promising a button that could never appear. `frontend/src/lib/platformDetect.js`
>   gained an `isAndroidDevice`/`"android"` branch so this copy can be targeted precisely
>   (desktop/other browsers keep the original generic fallback copy).
> - `mobile/src/hooks/useInstallPrompt.ts` is a new, adapted port of the same
>   capture-the-event-then-`.prompt()` pattern, now living on `mobile/`'s own origin —
>   the only place `beforeinstallprompt` can ever legitimately fire for this PWA. Unit
>   tested (`mobile/src/hooks/useInstallPrompt.test.tsx`, 5 tests, all passing): captures
>   the event, prevents the default mini-infobar, single-use `promptInstall()`, marks
>   `isInstalled` on `appinstalled`, and treats an already-standalone launch as installed.
> - The resulting "Install app" affordance is surfaced in two sensible, unobtrusive spots
>   on `mobile/`, both conditionally rendered only when `canPromptInstall` is true (i.e.
>   only when the browser has actually offered the real prompt): the pre-auth
>   `mobile/src/pages/Login.tsx` screen (for first-time visitors, below the sign-in form)
>   and the post-auth `mobile/src/pages/shell/Profile.tsx` tab (for returning users), both
>   styled with the app's existing Clinical Trust Blue tokens and a rare, one-time `pop-in`
>   entrance per the art-direction's motion rules.
> - Re-verified with a scripted Playwright (Chromium, Android/Pixel-7 UA) session against
>   both `mobile/` routes: dispatching a synthetic `beforeinstallprompt` event (headless
>   Chromium does not reliably fire the real one — a known, documented tooling limitation,
>   not treated as a blocker) made the "Install"/"Install app" button appear on both the
>   Login and Profile screens, and clicking it invoked the captured event's `.prompt()`
>   exactly once in both cases, with zero console errors. `npm run build` passes for both
>   `frontend/` and `mobile/`.
> - A fresh, from-scratch QA pass (screenshots + the full acceptance-bullet checklist)
>   should still re-verify this end-to-end against a real deployed environment before
>   sign-off; the verification above was done by the engineer making the fix, not by an
>   independent QA pass.

Original finding (superseded by the fix above, kept for context):

Observed: no native "Install App" button rendered; the banner fell back to the generic
"Open the app →" link + note. Console errors: none.

This is not simply "`beforeinstallprompt` doesn't fire under Chromium automation" (a
known, environment-only limitation the spec anticipated). I checked `frontend/index.html`
directly: it has **no `<link rel="manifest">` and no service-worker registration of its
own** — `frontend/` itself is not a PWA. `beforeinstallprompt` is dispatched only to the
window of the document currently being evaluated for installability (based on *that
document's own* manifest + service worker), never for a link to a different origin's PWA.
Since the banner lives on the `frontend/` Login page (a different origin/app from the
`mobile/` PWA it links to), `useInstallPrompt`'s `beforeinstallprompt` listener can
**never fire in any real browser**, not just in this automated test — the "native OS
install prompt" button the plan calls for on Android is unreachable as currently
architected. In production, every Android/Chrome visitor will always see the "Open the
app" fallback, never the true one-tap native install button described in the spec's
scope section ("show an Install App button that triggers the real OS install prompt
directly").
The fallback path itself works correctly and is a reasonable degrade, but the specific
acceptance bullet ("capture the browser's native `beforeinstallprompt` event... trigger
the real OS install prompt directly") is not met by the current implementation for any
Android user, ever.

**iOS Safari (iPhone UA, `isMobile`/`hasTouch` true) — PASS**
- "Add to Home Screen" button rendered (not the Android/fallback branch).
- Clicking it opened the instructions dialog: "Add to Home Screen" title, steps text
  matched — "Open this page in Safari, then tap the Share icon..." and "...tap Add to
  Home Screen" both present.
- Zero console errors.
- Screenshot: `qa/pwa-login-ios-before-click.png` (dialog open, showing all 3 numbered
  steps).

**Desktop Chrome (no special UA/viewport) — PASS**
- Fallback "Open the app →" link + the "Installing to your home screen depends on your
  browser..." note rendered, as designed for non-mobile/non-matched platforms.
- Zero console errors.
- Screenshot: `qa/pwa-login-desktop.png`.

### B3. Screenshot of iOS-instructions-open state — PASS
`qa/pwa-login-ios-before-click.png` shows the dialog open with all three steps
(Share icon → Add to Home Screen → Add) and the underlying banner/login page dimmed
behind it.

### B4. No regressions to rest of Login page across all states — PASS
In every scenario tested (env unset, Android, iOS, desktop) the email input, password
input, and "Sign In" button were present in the DOM (`#email`, `#password`,
`button[type="submit"]` all found) and visually intact in every screenshot above.

## Summary

| # | Criterion | Result |
|---|---|---|
| A1 | `mobile/` production build includes manifest/SW/icons | PASS |
| A2 | Manifest valid + resolves, SW registers/controls, icons all 200 | PASS |
| A3 | Screenshot of app loading | PASS |
| B1 | Banner absent + no regression when env var unset | PASS |
| B2-Android | Native `beforeinstallprompt` "Install App" button | **FIXED, pending independent re-verification** (relocated the capture to `mobile/`'s own origin, where it can work; see addendum above) |
| B2-iOS | "Add to Home Screen" button + instructions dialog | PASS |
| B2-Desktop | Fallback "Open the app" link + note | PASS |
| B3 | Screenshot of iOS instructions-open state | PASS |
| B4 | Login form regression check across all states | PASS |

**Totals (original pass): 8 PASS, 1 FAIL, 0 NOT TESTABLE.**
**Post-fix: the 1 FAIL has an engineering fix applied and self-verified (see addendum
under B2-Android above); recommend a fresh independent QA pass to confirm before
sign-off.**
