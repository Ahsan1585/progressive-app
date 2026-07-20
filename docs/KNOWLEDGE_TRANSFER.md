# Progressive Steps NJ / Izaya EIMS — Knowledge Transfer Document

**Last generated:** 2026-07-20
**Audience:** a new engineer or PM who needs to get productive on this codebase quickly.

This document was produced by reading the actual source in `frontend/`, `mobile/`, and
`backend/`, the git history, and the config files. Where something could not be determined
from the code alone, it is called out explicitly in "Open Questions" at the end.

> This supersedes the 2026-07-09 version of this document. The biggest change since then:
> a full **mobile PWA** (`mobile/`) was built for practitioners, and the backend **migrated
> from Supabase (Postgres + Storage) to Google Cloud SQL + Cloud Storage, deployed on Cloud
> Run instead of Render**. Anything below describing Supabase/Render is history, not current
> state, unless explicitly marked as a migration note.

---

## 1. Product Overview

**Progressive Steps NJ** (product/engineering codename **Izaya EIMS**, "Early Intervention
Simplified") is used by an early-intervention therapy agency operating under **NJEIS (New
Jersey Early Intervention System)**. It replaces paper NJEIS encounter forms and manual
billing with a digital workflow that:

- Lets **practitioners** (occupational/physical/speech therapists, etc.) log home-visit /
  clinic sessions with a child, capture parent + practitioner signatures on a canvas pad,
  and submit them — from a desktop browser (`frontend/`) or a phone as an installable PWA
  (`mobile/`).
- Lets **billing/admin staff** review those logs, generate the state-mandated NJEIS billing
  form (internally called **"SEVF"** in the UI — see §9 on terminology drift) and a
  practitioner pay invoice, track the review lifecycle (pending → in review → invoiced, or
  returned/declined), lock a practitioner's row while working it to prevent two specialists
  colliding, and export audit reports.
- Enforces role-based access (practitioner vs. four admin sub-roles) and produces
  downloadable, filled-in PDF versions of the official `NJEIS-020` state form plus a custom
  pay invoice, stored in Google Cloud Storage.
- Lets a practitioner self-manage their profile picture and submit contact-info changes
  (address/phone) that go through an admin approval queue in Staff Directory before taking
  effect.

There is no patient/parent-facing portal — only an **admin/billing portal** (desktop web
only) and a **practitioner portal**, which exists as both a desktop web app and a mobile PWA,
sharing one login system and backend.

---

## 2. The Three Surfaces

### Practitioner Web Portal (`frontend/`, `/dashboard`, role = `practitioner`)
- `frontend/src/pages/dashboard.jsx` — patient roster (add/search/select/delete patients, via
  `AddPatientModal.tsx`), per-patient session history, "Log Session" flow
  (`LogInterventionModal.jsx` — date, start/end time with a live auto-calculated **Total
  Time** pill, NJEIS service type/status/location codes, parent + practitioner signature
  capture), a reusable saved signature, a rejected/returned-logs inbox (revise & resubmit, or
  acknowledge a hard decline), and a quick-stats card (logs/hours this month, pipeline count).

### Practitioner Mobile PWA (`mobile/`, practitioner-only — every other role hits a dead-end screen)
A separate Vite/React/TypeScript app, installable to a phone home screen, mirroring the web
practitioner experience with a native-app shell (tab bar, push screens, splash screen):
- **Tabs**: Home (dashboard/stats/quick actions), Roster (patient list + search/filter,
  sorted by most-recent service), Inbox (rejected/returned logs), Profile (signature,
  password, contact info, profile picture, install prompt, logout).
- **Pushed screens**: add/edit patient, patient detail, log a session, resubmit a rejected
  log, manage signature, change password, edit contact info.
- Auto-refetches each tab's data on every landing (route components fully remount on
  navigation in this app, so a plain mount effect substitutes for the native pull-to-refresh
  gesture, which is intentionally disabled — see §6).
- Ships as an installable PWA (manifest + service worker via `vite-plugin-pwa`), with install
  prompts surfaced both from a Profile tab button and, for first-time phone visitors on the
  public login page, a dismissible install banner.

### Admin Portal (`frontend/`, `/admin-dashboard`, roles = `ceo`, `staff_director`, `billing`, `account_specialist`)
- `frontend/src/pages/AdminDashboard.jsx` — sidebar-driven shell, tabs gated per role
  (`TAB_ACCESS` map):
  - **Billing** (`ceo`, `billing`, `account_specialist`) → `BillingManager.jsx`. Two-step
    billing pipeline: "Pending Bills" → generate SEVF (NJEIS) forms → generate Invoice →
    "Completed Bills" vault, plus an "Invoice Status" surface for print/paid tracking.
    Supports accept/decline/return of individual logs, per-practitioner row **locking**
    (claim a practitioner's queue while working it — see §4), batch revert ("Send Back to
    Pending"), and downloading generated PDFs.
  - **Practitioners** (`ceo`, `staff_director`, `account_specialist`) →
    `RegisterPractitionerForm.jsx` — staff roster (search/filter active vs. deactivated,
    change role, deactivate/reactivate), a "provision new staff member" form (temp password,
    forced change on first login), multi-select **Service Types** assignment (which then
    constrains what session types that practitioner can log), a clickable **profile photo
    lightbox**, and a **Pending Update** review dialog for self-submitted contact-info
    changes (Accept/Reject, current-vs-requested comparison).
  - **Reports** (`ceo` only) → `MasterReports.jsx` — a separate, older audit/reporting
    surface with 5 modules (Practitioner Logs, Patient History, Financial Audit, Compliance
    Flags, and an org-wide **All Patients** roster), free-text search/filters, a "generate
    merged audit NJEIS PDF" action, a printable audit report PDF, and an "invoice override"
    action for declined/returned logs that force-issues an invoice anyway.

**Role model (5 roles, all stored in `practitioners.role`):**
| Role | UI label | Access |
|---|---|---|
| `practitioner` | Practitioner | Practitioner web dashboard + mobile app only |
| `staff_director` | Office Manager | Admin: Practitioners tab only; can provision practitioners only |
| `billing` | Billing Specialist | Admin: Billing tab (cannot mark invoices printed/paid — see below) |
| `account_specialist` | (new since last doc) | Admin: Practitioners + Billing tabs, including printed/paid status writes |
| `ceo` | Admin | Admin: all three tabs, only role that can change roles / deactivate / force-release a billing lock |

Note the asymmetry inside Billing: `billing` can do everything on Pending/Completed Bills
*except* mark an invoice batch printed/paid (`markBatchPrinted`/`markBatchPaid` are guarded
to `ceo`/`account_specialist` only — see `backend/src/routes/billingRoutes.js`).

---

## 3. Tech Stack

**Frontend** (`frontend/`)
- React, React Router DOM, Vite, Tailwind CSS 4 (via `@tailwindcss/vite`)
- Shadcn/Radix UI primitives (`components/ui/*`) + `class-variance-authority`, `tailwind-merge`
- `react-hook-form` + `zod` for form validation; `axios` for HTTP
- Hand-rolled canvas signature pad (`SignaturePad.jsx`)
- Mixed `.jsx`/`.tsx` — TypeScript configured but only a handful of files (e.g.
  `AddPatientModal.tsx`, `lib/utils.ts`, `components/ui/*`) are actually typed; the large
  business-logic components (`dashboard.jsx`, `AdminDashboard.jsx`, `BillingManager.jsx`,
  `RegisterPractitionerForm.jsx`) remain plain `.jsx`.
- Deployed on **Vercel** (`frontend/vercel.json`: strict CSP/HSTS/X-Frame-Options headers +
  SPA rewrite).

**Mobile** (`mobile/`)
- React + TypeScript, Vite, React Router DOM, Tailwind, `vite-plugin-pwa`
- `vitest` for tests (the only part of the repo with an actual test runner configured), `oxlint`
- Custom shell components for the native-app feel: `ShellLayout`/`TabBar` (bottom tab bar),
  `PushScreen` (full-screen stacked views), `SplashScreen` (once per browser tab session, via
  `sessionStorage`), `IdleGate` (mirrors the web idle-logout policy)
- `html`/`body` pinned (`position:fixed; overscroll-behavior:none`) to kill rubber-band bounce
  and the native pull-to-refresh gesture — data freshness instead comes from refetch-on-mount
  per tab (see §2)
- Deployed on **Vercel** as a separate project (`mobile/vercel.json`: same security headers,
  plus PWA-specific CSP allowances and no-cache headers for the service worker/manifest)

**Backend** (`backend/`)
- Node.js, Express 5, CommonJS
- **Google Cloud SQL (Postgres)** via the `pg` driver — connects either through the Cloud SQL
  Auth Proxy's Unix socket (`INSTANCE_UNIX_SOCKET`, the Cloud Run production path) or a plain
  `DATABASE_URL` (local/other). *(Migrated off Supabase — see migration note below.)*
- **Google Cloud Storage** (`@google-cloud/storage`) for generated PDFs — two buckets,
  `njeis-billing-invoices` and `njeis-forms`. *(Migrated off Supabase Storage.)*
- Auth: `jsonwebtoken` (24h expiry), `bcrypt`
- `pdf-lib` — fills the official `NJEIS-020.pdf` AcroForm template and draws the pay-invoice
  PDF programmatically
- `puppeteer` — used for **invoice PDF stamping** (printed/paid overlay — see
  `utils/invoiceStamper.js`), not for the original invoice generation
- `helmet`, `cors` (allow-list via `CORS_ORIGIN`), `express-rate-limit` (login +
  forgot-password throttling), `zod`-adjacent validation in `patientSchema.js`
- `resend` — transactional email for the forgot-password flow
- Deployed on **Google Cloud Run** (`backend/Dockerfile`, `node:20-slim` base, Chrome
  installed for Puppeteer, `gcloud run deploy njeis-backend --source . --region us-east1`,
  Cloud SQL instance attached via `--add-cloudsql-instances`)

### Migration note: Supabase/Render → Cloud SQL/Cloud Run
The previous version of this document described a Supabase (Postgres + Storage) + Render
stack. That has been fully replaced. Residue from the migration still in the repo:
- `backend/node_modules` still has `@supabase/*` packages installed (dependency not yet
  pruned from `package.json`, or a leftover install — verify before assuming it's live).
- `frontend/.env` still contains a `VITE_SUPABASE_URL` var — appears to be dead/unused now.
- `frontend/.env.local` has a comment noting `VITE_API_URL` was pointed at a "Cloud SQL/Cloud
  Run migration staging backend" for local testing, with a note to revert if testing against
  "the old Render backend" — confirm with the team whether Render is fully decommissioned.
- **No migrations framework exists.** Every schema change is applied by hand via SQL the
  assistant/engineer writes and the user runs manually in Cloud SQL Studio. There is a
  `backend/db/schema.sql` file (see §5) that is a **reference snapshot reverse-engineered
  from the live database**, not a source of truth that's applied automatically — keep it
  updated by hand whenever a manual migration is run, or it will drift.

---

## 4. Architecture

```
Browser (React SPA, Vercel)              Phone (installed PWA, Vercel — separate project)
   │  axios + JWT bearer token               │  axios + JWT bearer token
   │  frontend/src/api/axiosInstance.js       │  mobile/src/api/axiosInstance.js
   ▼                                          ▼
                    Express API (Cloud Run, backend/index.js on PORT 8080)
                    │  helmet, CORS allow-list, express.json (10mb limit)
                    │  routes: /api/patients, /api/auth, /api/reports, /api/billing
                    │  + several inline routes in index.js (interventions, practitioner
                    │    profile/signature/profile-picture/contact-info, NJEIS PDF export)
                    ▼
        Cloud SQL (Postgres, via Unix socket proxy on Cloud Run)
        - Tables: practitioners, patients, assessments, billing_batches, billing_locks,
                  pending_contact_updates, master_reports, billing_invoices (legacy/unused)
        Google Cloud Storage
        - Buckets: njeis-billing-invoices (SEVF + Invoice PDFs, current pipeline),
                   njeis-forms (Master Reports module's PDFs, legacy/parallel pipeline)
```

### Auth flow
1. `POST /api/auth/login` (rate-limited, 10/15min/IP) — `bcrypt.compare` against
   `practitioners.password_hash`; a dummy-hash compare always runs even when the email
   doesn't exist, to prevent user-enumeration via timing. Checks `is_active` (soft-delete
   flag) before issuing a token.
2. JWT signed with `{ practitionerId, email, role }`, 24h expiry, `JWT_SECRET` from env
   (server **refuses to boot** if `JWT_SECRET` is unset).
3. Both frontend and mobile attach `Authorization: Bearer <token>` from localStorage to every
   request, and clear the session + redirect to login on any `401`.
4. `backend/src/middleware/authMiddleware.js` — `protect` verifies the JWT and sets
   `req.practitioner`; `requireRole([...])` gates by role.
5. First-login flow: admin-provisioned accounts get `requires_password_change = true` + a
   temp password; `POST /api/auth/change-password` clears the flag. Both web and mobile force
   a change-password screen client-side when this flag is set.
6. Self-service reset: `forgot-password` (rate-limited 5/15min) issues a SHA-256-hashed,
   30-minute token via email (Resend); `reset-password` consumes it. Both return a generic
   success message regardless of whether the email exists.
7. **Client-side idle logout** on both web (`App.jsx`'s `IdleLogout`) and mobile
   (`IdleGate`/`IdleWarningOverlay`): wipes the session after 15 minutes of no activity,
   framed as a HIPAA control. Mobile additionally shows a one-time "you were logged out"
   banner distinguishing idle-timeout from a hard session expiry (401).

### Practitioner self-service profile changes
- **Profile picture** — no approval step. `POST /api/practitioner/profile-picture`
  (self-service, `~1.5MB` decoded cap, must be a `data:image/...` URL) writes directly to
  `practitioners.profile_picture`. Mobile crops/resizes client-side first
  (`ImageCropSheet.tsx`: drag + pinch/zoom, canvas export to 480×480 JPEG). Visible to admins
  in Staff Directory, including a click-to-enlarge lightbox.
- **Contact info (address/phone)** — **does** require approval. Practitioner submits via
  `PATCH /api/practitioner/contact-info`, which upserts into a `pending_contact_updates` row
  (does not touch `practitioners` directly). An admin (`ceo`/`staff_director`/
  `account_specialist`) reviews it in Staff Directory (amber "Pending Update" badge → dialog
  showing current vs. requested values) and calls `POST /api/auth/staff/:id/contact-request`
  with `action: accept|reject`. Accept copies the pending values into `practitioners` and
  deletes the pending row; reject just deletes it. `GET /api/practitioner/profile` and
  `GET /api/auth/staff` both surface the pending values so both the practitioner and admins
  can see a submission is awaiting review.

### Billing row locking (per-practitioner concurrency control)
Added to prevent two billing specialists from working the same practitioner's Pending Bills
row simultaneously (risk of duplicate SEVF/invoice generation). `billing_locks` is a
one-row-per-locked-practitioner table (`practitioner_id` PK, `locked_by`, `locked_at`) —
locks never expire on their own.
- **Lock**: `POST /api/billing/practitioner/:id/lock` — claims the row and expands it for
  review in one action. Returns 409 with the current holder's name if already locked by
  someone else.
- **Release**: `POST /api/billing/practitioner/:id/unlock` — allowed by the lock-holder at
  any time, or by a `ceo` to force-release someone else's lock. Also released automatically
  once "Generate & Issue" finishes for that practitioner.
- `GET /api/billing/pending-logs` returns lock state (`locked_by_id`/`locked_by_name`) inline
  with each row, so the Pending Bills tab can render an amber **"IN PROGRESS BY \<NAME\>"**
  status and disable the row for everyone but the lock-holder and `ceo`, without a second
  poll.

### PDF generation pipeline (the core of the app)
Two independent generators, both built on `pdf-lib`:
1. **NJEIS "SEVF" form filler** (`utils/njeisGenerator.js`, and duplicated logic inline in
   `billingController.generateNJEISForms` / `index.js` / `reportController.generateAuditNJEIS`)
   — loads `backend/templates/NJEIS-020.pdf` (the real state AcroForm PDF), fills text fields
   (patient/practitioner name, DOB, county, up to 10 service rows/page, chunked across
   multiple pages/patients as needed), embeds PNG signatures at hard-coded coordinates,
   flattens the form. Discipline/position title is abbreviated to short codes and the
   month/year auto-filled on generated forms.
2. **Invoice generator** (`utils/invoiceGenerator.js`) — draws a pay-invoice PDF from scratch
   with `pdf-lib` (title, practitioner info, per-visit line items, a county-hours + total
   summary, certification block, signature line).
3. **Invoice stamper** (`utils/invoiceStamper.js`, Puppeteer-based) — overlays a "printed"
   and/or "paid" stamp onto an already-generated invoice PDF when a `ceo`/`account_specialist`
   marks a batch's status via `PATCH /api/billing/batch/:id/printed` or `/paid`.

Both generated PDFs are uploaded to the `njeis-billing-invoices` bucket under a
`YYYY-MM/FirstName_LastName/<Type>_<startdate>_<enddate>_<HHMMSS>.pdf` path convention, and
downloaded via short-lived signed URLs (never a public bucket); download URLs are validated
against a strict filename regex server-side to block path traversal.

There is a **second, separate PDF pipeline** used only by the "Reports" tab
(`reportController.generateMasterReport`), writing to the `njeis-forms` bucket and the
`master_reports` table — see §8.

### Billing state machine (the `assessments.billing_status` column)
```
pending ──(billing generates SEVF)──► njeis_review ──(billing generates invoice)──► invoiced
   │                                        │
   ├──(billing rejects, "return")──► rejected ──(practitioner resubmits)──► pending
   └──(billing rejects, "reject")──► declined ──(practitioner acknowledges, or CEO override)──► invoiced (via issueInvoiceOverride)
```
- `billing_review` records the admin's last action type (`accept`/`return`/`reject`).
- `rejection_count` increments each time a log is returned/declined.
- `acknowledged_at`/`practitioner_response`/`responded_at` track the practitioner's response
  to a decline.
- `billing_batch_id` links a group of assessments to one `billing_batches` row, which stores
  `njeis_path`/`invoice_path`/`stamped_invoice_path` and `printed_at`/`paid_at`. This linkage
  is what lets "Send Back to Pending" (`revertBillingBatch`) cleanly undo an entire batch.
- `is_override` flags logs that skipped the normal pipeline via a CEO-issued invoice override.

---

## 5. Data Model

Reverse-engineered from the live Cloud SQL Postgres instance and captured as a reference
snapshot in `backend/db/schema.sql` (not auto-applied — see the migration note in §3).

| Table | Purpose | Key columns / FKs |
|---|---|---|
| `practitioners` | All staff accounts, every role | `id` PK; `email` unique; `password_hash`; `role` (CHECK: `practitioner\|staff_director\|billing\|ceo\|account_specialist`); `requires_password_change`; `is_active` (soft-delete); `position_title`; `address`/`phone_number`/`ssn` (sensitive — allow-listed out of the profile endpoint); `pay_rate`; `saved_signature`; `service_types text[]`; `profile_picture`; `reset_token_hash`/`reset_token_expires` |
| `patients` | EI patient roster | `id` PK; `dob`/`county` NOT NULL; `child_id` unique, exactly 9 digits (Zod-validated client+server); `practitioner_id` FK → `practitioners`; `status` (`active`/`inactive`) |
| `assessments` | Core session/encounter log — one row per billable service | `id` PK; `patient_id`/`practitioner_id` FK; `form_data jsonb`; `parent_signature`/`practitioner_signature` (base64 PNG in-row, not in Storage); `service_date`/`start_time`/`end_time`/`total_time`; denormalized patient+practitioner snapshot columns (survive later edits/deactivation); billing state-machine columns (§4) |
| `billing_batches` | One generated billing run (practitioner + date range) | `id` uuid PK; `practitioner_id` FK; `njeis_path`/`invoice_path`/`stamped_invoice_path`; `printed_at`/`paid_at` |
| `billing_locks` | Per-practitioner concurrency lock on Pending Bills (new) | `practitioner_id` PK FK; `locked_by` FK → `practitioners`; `locked_at`; no expiry |
| `pending_contact_updates` | Self-submitted address/phone changes awaiting admin approval (new) | `practitioner_id` PK FK; `address`; `phone_number`; `submitted_at` |
| `master_reports` | Legacy/parallel audit table, Reports tab only | `id` PK; `practitioner_id`/`patient_id` FK; `included_assessment_ids jsonb`; `njeis_pdf_path`; `status` |
| `billing_invoices` | **Unreferenced by current code** — pre-migration table kept for data preservation, superseded by `billing_batches` | uuid PK; `line_items jsonb`; `pdf_path` |

### Service/status/location code vocabularies (hard-coded in `dashboard.jsx`/mobile equivalents, not DB-enforced)
- **Service type codes**: EV, AS, IFSP, AU, DI, FT, HS, MS, NU, NT, OT, PT, PSY, SLP, SW, VI,
  CC, I/T, ES, TPC. Since a recent change, a practitioner can only select from the subset of
  service types assigned to them in `practitioners.service_types` (Staff Directory sets this
  per-practitioner, multi-select).
- **Status codes** (1–5): Ongoing IFSP Service, Practitioner Missed/Cancelled, Family
  Missed/Cancelled, Make-up Service Provided, Compensatory Service Provided.
- **Location codes** (1–8): Home, Residential Facility, Service Provider Clinic/Office,
  Hospital (Inpatient), EC Program (disabilities), EC Program (inclusive community), DCP&P
  Office, Phone/Video Conferencing.

---

## 6. Key End-to-End Workflows

**A. Practitioner logs a session** (web or mobile — same backend contract)
1. Selects/adds a patient (`POST /api/patients/register`, Zod-validated both sides).
2. Fills date/time/type/status/location; sees a live auto-calculated **Total Time**; draws
   parent + practitioner signatures (or reuses a saved default).
3. `POST /api/interventions` (inline in `backend/index.js`) — verifies the patient belongs to
   the caller and that the submitted `type` is one of the practitioner's assigned
   `service_types`, then inserts into `assessments`.

**B. Billing reviews and pays out**
1. Billing/CEO/account_specialist opens **Pending Bills** → `GET /api/billing/pending-logs`
   — logs grouped by practitioner with a total-hours/children summary and current lock state.
2. Optionally **locks** the practitioner's row (claims it + expands it) before reviewing, so
   nobody else can double-work it; releases it explicitly or it auto-releases after Generate
   & Issue.
3. Per-log actions: accept (stays pending), **Return** (→ `rejected`, note required,
   practitioner must revise+resubmit), or **Reject** (→ `declined`, note required, terminal
   unless CEO overrides).
4. Selects a practitioner + date range, **Generate SEVF** → `POST
   /api/billing/generate-njeis` — fills/merges NJEIS PDF pages, uploads to
   `njeis-billing-invoices`, creates a `billing_batches` row, advances non-rejected logs to
   `njeis_review`.
5. **Generate Invoice** → `POST /api/billing/generate-invoice` — builds the pay invoice for
   `pending`+`njeis_review` logs in range, uploads it, stamps the batch's `invoice_path`,
   advances logs to `invoiced`, releases any lock on that practitioner.
6. Batch now appears in **Completed Bills**; can be expanded (`GET
   /api/billing/vault-logs`), have printed/paid status toggled (which stamps the PDF via
   Puppeteer), or reverted (`POST /api/billing/revert-batch`) if made in error.

**C. Practitioner handles a rejected/declined log**
1. `GET /api/patients/rejected-logs` surfaces un-acknowledged `rejected`/`declined` logs (web
   Inbox / mobile Inbox tab).
2. `rejected` ("Return"): edit and `POST /api/patients/resubmit-log` → back to `pending`.
3. `declined` ("Reject", terminal): `POST /api/patients/acknowledge-log`, optional response
   note. A CEO can later force-pay via `POST /api/reports/issue-override`, bypassing SEVF.

**D. Admin provisions a new staff member**
1. `ceo`/`staff_director`/`account_specialist` fills the registration form → `POST
   /api/auth/register-practitioner`. Server re-validates role rules server-side (Office
   Manager/account_specialist can only create `practitioner` accounts), password strength,
   pay-rate requirement, and assigns `service_types`.
2. New user logs in with the temp password → forced to change-password before reaching their
   portal (web) or tab shell (mobile).

**E. Practitioner updates their profile**
1. **Photo**: tap avatar → pick a photo → crop/zoom (mobile) → `POST
   /api/practitioner/profile-picture` → live immediately, visible to admins in Staff
   Directory.
2. **Contact info**: edit address/phone → `PATCH /api/practitioner/contact-info` → goes into
   `pending_contact_updates`, shown as "Awaiting admin approval" until an admin accepts or
   rejects it in Staff Directory.

**F. CEO runs an audit** (Reports tab)
`GET /api/reports/audit-logs` — filter by practitioner/patient/date range/billing status, or
a "compliance" mode flagging logs >30 days old still stuck pre-invoice. Exports a merged
NJEIS PDF or a formatted audit summary PDF.

**G. First-time mobile visitor installs the app**
Visiting the public login page (`progressive-app-vert.vercel.app`) on a phone for the first
time shows a dismissible bottom install banner (gated by viewport width + a
`localStorage`-backed "seen" flag) linking to the mobile app's install URL, in addition to
the desktop-visible QR code.

---

## 7. Directory / File Map

```
progressive-app-md/
├── docs/KNOWLEDGE_TRANSFER.md    this document
├── design/, qa/, specs/          artifacts from the feedback→feature agent pipeline
│                                  (product spec / UX / QA reports per feature slug)
├── backend/
│   ├── index.js                  Express entrypoint; ALSO several inline routes
│   │                              (interventions, practitioner profile/signature/
│   │                              profile-picture/contact-info, NJEIS PDF export)
│   │                              duplicating logic found in the organized controllers
│   ├── Dockerfile, .dockerignore, .gcloudignore   Cloud Run deploy config
│   ├── db/schema.sql             reference snapshot of the live Cloud SQL schema —
│   │                              NOT auto-applied, update by hand after manual migrations
│   ├── templates/NJEIS-020.pdf   the official fillable state AcroForm template
│   └── src/
│       ├── config/db.js          pg Pool — Cloud SQL Unix socket or DATABASE_URL
│       ├── config/storage.js     Google Cloud Storage wrapper (upload/download/signed URLs)
│       ├── middleware/authMiddleware.js   protect / requireRole
│       ├── routes/               authRoutes, patientRoutes, billingRoutes, reportRoutes
│       ├── controllers/          authController, patientController, billingController, reportController
│       └── utils/
│           ├── invoiceGenerator.js  pdf-lib pay-invoice generator
│           ├── invoiceStamper.js    Puppeteer-based printed/paid PDF stamping
│           ├── njeisGenerator.js    NJEIS PDF filler (Reports/Master Reports path)
│           ├── patientSchema.js     Zod schema for patient registration
│           ├── disciplineCodes.js   discipline → short-code abbreviation map
│           └── emailClient.js       Resend wrapper for password-reset emails
├── frontend/                      practitioner web dashboard + admin portal (Vercel)
│   └── src/
│       ├── App.jsx                Router, role-gated ProtectedRoute, 15-min idle-logout
│       ├── pages/                 Login, ForgotPassword, ResetPassword, dashboard, AdminDashboard
│       └── components/            AddPatientModal, LogInterventionModal, SignaturePad,
│                                    BillingManager, MasterReports, InvoiceHistory,
│                                    RegisterPractitionerForm, ChangePassword, ui/*
└── mobile/                        practitioner-only PWA, separate Vite/TS app (Vercel)
    └── src/
        ├── App.tsx                Router; RequireAuth/RequireGuest/RequireForcedChange guards
        ├── contexts/               AuthContext (session), AppDataContext (shared fetches)
        ├── pages/                 Login, ForgotPassword, ResetPassword, ForcedPasswordChange,
        │                          AddPatient, EditPatient, PatientDetail, LogIntervention,
        │                          ResubmitLog, ManageSignature, EditContactInfo, UnsupportedRole
        ├── pages/shell/           Home, Roster, Inbox, Profile (bottom-tab screens)
        └── components/            ImageCropSheet, SignatureCapture, shell/* (AppBar, TabBar,
                                     PushScreen, SplashScreen, IdleGate), ui/*
```

---

## 8. Known Risks / Tech Debt

1. **Two parallel billing/reporting pipelines.** The "Billing Manager" tab (pending → SEVF →
   invoice → completed vault, `billing_batches`, `njeis-billing-invoices` bucket) is the
   actively-developed system — essentially all recent commits touch it. The "Reports" tab
   (`MasterReports.jsx`/`reportController.generateMasterReport`, `master_reports` table,
   `njeis-forms` bucket, a **third** `billing_status` value `locked_in_report` not used
   elsewhere) looks like an earlier or parallel design never fully merged into the main
   pipeline. Both are live and reachable today.
2. **Route organization is inconsistent.** Several routes live directly in `backend/index.js`
   instead of the modular `src/routes/*` + `src/controllers/*` pattern. NJEIS PDF generation
   logic is essentially duplicated across `index.js`, `billingController.js`, and
   `njeisGenerator.js`/`reportController.js` with slightly different signature-placement and
   county-handling logic — a bug fixed in one copy won't automatically apply to the others.
3. **Mixed `.jsx`/`.tsx` on the web app.** TypeScript is fully configured but the largest,
   most complex components (`BillingManager.jsx`, `dashboard.jsx`, `AdminDashboard.jsx`,
   `RegisterPractitionerForm.jsx`) remain untyped `.jsx` — no compile-time safety on most
   business logic. (The mobile app, by contrast, is fully TypeScript.)
4. **No migrations / schema-as-code.** `backend/db/schema.sql` is a manually-maintained
   snapshot, not an applied source of truth — every schema change is hand-run SQL in Cloud
   SQL Studio. It's easy for this file to silently drift from the real database if a change
   is applied without also updating it.
5. **No automated tests on the web app or backend.** Only `mobile/` has a test runner
   (`vitest`) configured; no `__tests__` or CI config (`.github/workflows`) exist for
   `frontend/` or `backend/`. All verification there is manual/production testing.
6. **Signatures stored as base64 in Postgres rows**, not in Cloud Storage —
   `assessments.parent_signature`/`practitioner_signature` carry full base64 PNG data URLs.
   Works, but bloats table rows/backups with binary data that arguably belongs in object
   storage with a URL reference. The same low-cost-inline-base64 pattern was deliberately
   reused for `practitioners.profile_picture` rather than adding GCS bucket storage for it.
7. **User-facing terminology has diverged from code/DB terminology.** UI labels ("Pending
   Bills", "Completed Bills", "SEVF") don't match underlying code (`billing_status` values,
   `generateNJEISForms`, `njeis-forms` bucket, `NJEIS-020.pdf`, all still "NJEIS"). New
   engineers reading support tickets ("SEVF form") need to know this maps to "NJEIS" in code.
8. **Supabase migration residue.** `@supabase/*` packages still present in
   `backend/node_modules`; `frontend/.env` still has an unused `VITE_SUPABASE_URL`; a comment
   in `frontend/.env.local` suggests Render may not be fully decommissioned. Worth a cleanup
   pass and an explicit confirmation with the team that Supabase/Render are fully retired.
9. **No `backend/.env.example` committed**, unlike `mobile/.env.example` (which documents
   `VITE_API_URL`). A new engineer has no in-repo reference for what backend env vars are
   required (`JWT_SECRET`, `CORS_ORIGIN`, `INSTANCE_UNIX_SOCKET`/`DB_USER`/`DB_PASSWORD`/
   `DB_NAME` or `DATABASE_URL`, `GCS_BILLING_INVOICES_BUCKET`, `GCS_NJEIS_FORMS_BUCKET`,
   `FRONTEND_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`) — worth adding one.
10. **`billing_invoices` table is dead** — superseded by `billing_batches`, unreferenced by
    any current backend code, kept only for data preservation from the pre-migration DB.

---

## 9. Recent Development Activity (last ~25 commits, most-recent first)

The arc since the previous knowledge-transfer pass: **mobile app parity build-out → billing
concurrency safety (row locking) → login/marketing page redesign and polish.**

- Most recent: mobile login page mobile-viewport bug fixes (cropped illustration, headline
  overflow, low-contrast text) driven by screenshot review.
- Self-service contact info with admin approval workflow; auto-refresh on tab landing
  (mobile).
- Photo crop UI, admin photo lightbox, mobile scroll/splash bug fixes.
- Mobile/web practitioner-experience parity pass + profile pictures.
- "Log Intervention" renamed to "Log Session"; live Total Time display added.
- **Billing row locking**: `1d28482` "Show Locked badge in Status column", `21b6eba` "Fix
  Pending Bills going blank when billing_locks table is missing", `fd227c9` "Add
  practitioner row locking to the Pending Bills billing queue" — this is the concurrency
  feature described in §4.
- Reset button for practitioner/date filters on billing tabs; county hours + total amount
  summary added to generated invoices.
- Login page migrated to a full marketing/sign-in landing page design (`d67d12e`), followed
  by several rounds of mobile-responsiveness fixes.
- Launch splash animation added to the mobile app.
- Practitioners allowed to edit patients and toggle active/inactive status; org-wide patient
  roster added to Master Reports.
- Search + role filter added to Staff Directory.
- (Slightly older, not shown above but relevant): multi-select Service Types added to
  registration/staff editing, with session-type options on the logging form restricted to a
  practitioner's assigned service types; invoice printed/paid tracking with PDF stamping.

**What this suggests about current priorities:** initial mobile build-out is essentially
complete and parity-tested against the web app; the team is now iterating on **billing-ops
safety** (row locking to prevent duplicate work) and **first-impression polish** (the public
marketing/login page, PWA installability). The "Reports"/Master Reports pipeline and the
dead-code items in §8 have not been touched recently.

---

## 10. Open Questions / Gaps for a Human to Clarify

1. **Is the "Reports"/Master Reports pipeline still actively used, or a deprecation
   candidate?** Materially affects data-model understanding — it's a second source of truth
   for "this assessment has been billed" via the `locked_in_report` status.
2. **Is Render fully decommissioned**, or is there still a live Render deployment alongside
   Cloud Run? `frontend/.env.local` has a comment implying uncertainty here.
3. **Are the `@supabase/*` packages, and the unused `VITE_SUPABASE_URL` env var, safe to
   fully remove**, or is anything (a script, a one-off migration tool) still relying on them?
4. **Has `pending_contact_updates`'s manual migration SQL definitely been run in
   production?** It was handed to the user to run by hand in Cloud SQL Studio; confirm before
   assuming the contact-info approval feature is live end-to-end in prod.
5. **Deployment/ops details not fully visible from code**: exact Cloud Run service config,
   whether a staging environment/staging DB exists, how `NJEIS-020.pdf` gets updated if the
   state revises the form, and whether GCS buckets have any lifecycle/retention policy for
   old invoice PDFs.
6. **HIPAA/compliance program specifics** — the code has clear HIPAA-flavored controls (rate
   limiting, 15-minute idle logout, PHI ownership checks on every patient/assessment query),
   but no BAA/compliance documentation exists in-repo.
7. **Test/QA process for `frontend/`/`backend/`** — with no automated tests there (unlike
   `mobile/`, which has `vitest`), it's unclear whether there's a manual QA checklist or if
   changes go straight from local dev to production. The `qa/` directory at the repo root
   holds Playwright-driven QA reports for individual mobile features built via the
   feedback→feature agent pipeline, not a general regression suite.
