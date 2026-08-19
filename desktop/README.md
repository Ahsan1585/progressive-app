# Izaya EIS — Admin Dashboard Desktop App

Electron shell around `frontend/`'s admin-dashboard build. This package
contains **only** Electron-specific code (main process, preload, packaging
config) — it does not contain a copy of the React app. It builds and loads
`frontend/dist-desktop`'s output as an artifact; it never imports from
`frontend/src`.

Scope: Login + ChangePassword + AdminDashboard only (CEO/staff roles).
Practitioners keep using the separate `mobile/` PWA — the practitioner
`/dashboard` route, `/platform-admin`, and every marketing page are excluded
from this build (see `frontend/src/App.jsx`'s `DESKTOP_ROUTES`).

## Setup

1. `cd frontend && npm install` (if not already done for the web app).
2. `cd desktop && npm install`.
3. Create `frontend/.env.desktop` if it doesn't already exist (not committed —
   same convention as `frontend/.env.local`):
   ```
   VITE_API_URL="https://njeis-backend-996984273416.us-east1.run.app"
   VITE_BUILD_TARGET=desktop
   ```

## Development (hot-reload)

Two terminals:
```
cd frontend && npm run dev -- --mode desktop
cd desktop && npm run dev
```
The Electron window loads `http://localhost:5173` directly (`ELECTRON_DEV=1`,
set by `npm run dev` in this package) instead of a built file, and opens
DevTools automatically.

## Packaging (Windows installer)

```
cd desktop && npm run package:win
```
Builds `frontend`'s desktop bundle (`frontend/dist-desktop`), then runs
electron-builder against it. Output lands in `desktop/release/`.

**No code signing configured** — the installer is unsigned, so Windows
SmartScreen will show an "unknown publisher" warning on first run. Acceptable
for now since this is distributed directly to the team, not publicly. Revisit
if that changes.

## Auto-update

`electron-updater` is wired in `src/main.js`, checking on launch. The publish
target is GitHub Releases on this same repo (`Ahsan1585/progressive-app`) —
free, no separate update-hosting service. To ship an update:
```
cd desktop && npm run release:win
```
(same as `package:win` but also publishes the installer + update metadata to
a GitHub Release). Requires a `GH_TOKEN` env var with `repo` scope when
publishing from a private repo — electron-builder reads this automatically,
it's not stored anywhere in this package.

## Deferred / not done in v1

- **JWT storage stays in plain `localStorage`** (Electron's default
  per-app-user partition), not hardened via Electron's `safeStorage` API.
  The token is a short-lived bearer token with no client-tracked expiry
  (server-enforced only, same as the web app), so this is parity with
  today's web app, not a regression. `safeStorage` would need IPC plumbing
  through `preload.js` and migration handling for existing localStorage
  values — worth it if a HIPAA security review specifically calls it out,
  not before.
- **Quit/relaunch persists the session** (same as closing/reopening a browser
  tab doesn't log you out on the web app today). Intentional, not a bug — but
  worth knowing, since a desktop "app" can carry a different mental model
  than a browser tab for some users.
- **No macOS/Linux build** — Windows (NSIS) only. A Mac build needs its own
  code-signing/notarization setup, an `.icns` icon, and different
  quit/dock-icon behavior in `main.js`; treat as a separate project.
- **CORS**: verified empirically (see the main plan) that Electron's
  `file://`-loaded renderer sends no `Origin` header, which the backend
  (`backend/index.js`) already allows unconditionally — no server-side change
  was needed. If that ever changes (e.g. switching to `loadURL` with a real
  origin), the fallback is adding that origin to the backend's `CORS_ORIGIN`
  env var on Cloud Run.
