# Progressive Steps NJ — Knowledge Transfer Document

**Last generated:** 2026-07-09
**Audience:** a new engineer or PM who needs to get productive on this codebase quickly.

This document was produced by reading the actual source in `frontend/` and `backend/`, the
git history, and the config files. Where something could not be determined from the code
alone, it is called out explicitly in "Open Questions" at the end.

---

## 1. Product Overview

**Progressive Steps NJ** is a web app used by an early-intervention therapy agency operating
under **NJEIS (New Jersey Early Intervention System)**. It replaces paper NJEIS encounter
forms and manual billing with a digital workflow that:

- Lets **practitioners** (occupational/physical/speech therapists, etc.) log home-visit /
  clinic interventions with a child, capture parent + practitioner signatures on a canvas pad,
  and submit them.
- Lets **billing/admin staff** review those logs, generate the state-mandated NJEIS billing
  form (internally called **"SEVF"** in the UI — see §9 on terminology drift) and a
  practitioner pay invoice, track the review lifecycle (pending → in review → invoiced,
  or returned/declined), and export audit reports.
- Enforces role-based access (practitioner vs. three admin sub-roles) and produces
  downloadable, filled-in PDF versions of the official `NJEIS-020` state form plus a
  custom pay invoice, stored in Supabase Storage.

There is no patient/parent-facing portal — only two internal portals: **Practitioner Portal**
and **Admin Portal** (shared login system, role-gated after auth).

---

## 2. The Two Portals

### Practitioner Portal (`/dashboard`, role = `practitioner`)
- `frontend/src/pages/dashboard.jsx` (~878 lines) — the whole practitioner experience in one page:
  - Patient roster (add/search/select/delete patients), via `AddPatientModal.tsx`.
  - Per-patient intervention/encounter history.
  - "Log Intervention" flow (`LogInterventionModal.jsx`) — date, start/end time (auto-computes
    total time), NJEIS service type code, status code, location code, and parent +
    practitioner signature capture (`SignaturePad.jsx`).
  - A saved/default signature the practitioner can reuse (`GET/POST /api/practitioner/profile`,
    `/api/practitioner/signature`).
  - "Rejected/Returned logs" inbox — practitioner can view billing's rejection note, either
    **revise & resubmit** the log or **acknowledge** a hard decline with an optional response
    note.
  - Quick stats card (logs this month, hours this month, logs still in the billing pipeline)
    via `GET /api/patients/practitioner-stats`.
  - An "empty state" mini-dashboard when no patient is selected.

### Admin Portal (`/admin-dashboard`, roles = `ceo`, `staff_director`, `billing`)
- `frontend/src/pages/AdminDashboard.jsx` — sidebar-driven shell, auto-hide flyout nav on
  desktop, hamburger on mobile. Tabs are gated per role (`TAB_ACCESS` map):
  - **Billing** (`ceo`, `billing`) → `BillingManager.jsx` (~1121 lines, the largest/most
    complex component). Two-step billing pipeline: "Pending Bills" → generate SEVF (NJEIS)
    forms → generate Invoice → "Completed Bills" vault. Supports accept/decline/return of
    individual logs, batch revert ("Send Back to Pending"), and downloading generated PDFs.
  - **Practitioners** (`ceo`, `staff_director`) → `RegisterPractitionerForm.jsx` — dual-purpose:
    staff roster (view/filter active vs. deactivated, change role, deactivate, reactivate) and
    a "provision new staff member" form (sets a temporary password the user must change on
    first login). `staff_director` may only provision `practitioner` role accounts; only `ceo`
    can change roles or deactivate/reactivate.
  - **Reports** (`ceo` only) → `MasterReports.jsx` — a separate, older audit/reporting surface
    with 4 modules (Practitioner Logs, Patient History, Financial Audit, Compliance Flags),
    free-text search/filters, a "generate merged audit NJEIS PDF" action, a printable audit
    report PDF (via `pdf-lib`, not Puppeteer), and an "invoice override" action for
    declined/returned logs that lets the CEO force-issue an invoice anyway.

**Role model (4 roles, all stored in `practitioners.role`):**
| Role | Access |
|---|---|
| `practitioner` | Practitioner Portal only |
| `staff_director` ("Office Manager" in UI) | Admin: Practitioners tab only; can provision practitioners only |
| `billing` ("Billing Specialist" in UI) | Admin: Billing tab only |
| `ceo` ("Admin" in UI) | Admin: all three tabs, only role that can change roles/deactivate/reactivate staff |

---

## 3. Tech Stack

**Frontend** (`frontend/`)
- React **19.2.6**, React Router DOM **7.17**, Vite **8.0** (`@vitejs/plugin-react`)
- Tailwind CSS **4.3** (via `@tailwindcss/vite`, not the classic PostCSS plugin path)
- Shadcn/Radix UI primitives (`components/ui/*.tsx`: button, dialog, input, label, select,
  textarea, tooltip, badge, form) + `class-variance-authority`, `tailwind-merge`
- `react-hook-form` + `@hookform/resolvers` + `zod` **4.4** for form validation
- `axios` for HTTP, `react-signature-canvas` dependency present but the app actually uses a
  **hand-rolled** canvas signature pad (`SignaturePad.jsx`) rather than that library
- Mixed `.jsx` and `.tsx` — TypeScript is configured (`tsconfig.json`, `@types/*`) but only
  `AddPatientModal.tsx`, `lib/utils.ts`, and the `components/ui/*` are actually typed; the
  rest of the app (dashboard, AdminDashboard, BillingManager, etc.) is plain `.jsx`.
- Deployed on **Vercel** (`vercel.json` sets strict CSP/HSTS/X-Frame-Options headers and SPA
  rewrites).

**Backend** (`backend/`)
- Node.js, **Express 5.2**, CommonJS (`require`, not ESM)
- `@supabase/supabase-js` **2.108** — Postgres + Storage client
- Auth: `jsonwebtoken` **9.0** (24h expiry), `bcryptjs` for hashing (note: both `bcrypt` and
  `bcryptjs` are listed as deps — only `bcryptjs` is actually imported by the controllers)
- `pdf-lib` **1.17** — fills the official `NJEIS-020.pdf` AcroForm template and draws the
  pay-invoice PDF programmatically
- `puppeteer` **25.1** — present as a dependency but **its only real integration
  (`utils/pdfGenerator.js`, an HTML→PDF invoice via headless Chrome) is dead code, never
  imported anywhere**; the live invoice generator (`utils/invoiceGenerator.js`) uses pure
  `pdf-lib` instead (see git log: "Replace Puppeteer invoice generator with pdf-lib")
- `helmet`, `cors` (origin allow-list via `CORS_ORIGIN` env var), `express-rate-limit`
  (login + forgot-password throttling), `zod` for the patient-registration schema
- `resend` — transactional email for the forgot-password flow (no-ops gracefully if
  `RESEND_API_KEY` is unset)
- Deployed on **Render** (the self-ping keep-alive block in `index.js` targeting
  `RENDER_EXTERNAL_URL` is a free-tier "don't let it sleep" workaround)

---

## 4. Architecture

```
Browser (React SPA, Vercel)
   │  axios + JWT bearer token (frontend/src/api/axiosInstance.js)
   ▼
Express API (Render, backend/index.js on PORT 3000)
   │  helmet, CORS allow-list, express.json (10mb limit)
   │  routes: /api/patients, /api/auth, /api/reports, /api/billing
   │  + a few routes still defined inline in index.js (interventions, practitioner profile,
   │    practitioner/admin NJEIS PDF export) — see §9 tech debt
   ▼
Supabase (hosted Postgres + Storage), accessed via service-role key
   - Tables: practitioners, patients, assessments, billing_batches, master_reports
   - Storage buckets: billing-Invoices (SEVF + Invoice PDFs, current pipeline),
                       njeis-forms (Master Reports module's PDFs, legacy/parallel pipeline)
```

### Auth flow
1. `POST /api/auth/login` (rate-limited, 10/15min/IP) — `bcryptjs.compare` against
   `practitioners.password_hash`; a **dummy-hash compare is always run even when the email
   doesn't exist**, specifically to prevent user-enumeration via timing. Checks
   `is_active` (soft-delete flag) before issuing a token.
2. JWT signed with `{ practitionerId, email, role }`, 24h expiry, `JWT_SECRET` from env
   (server **refuses to boot** if `JWT_SECRET` is unset — see `index.js` line 8-10).
3. `frontend/src/api/axiosInstance.js` attaches `Authorization: Bearer <token>` to every
   request from `localStorage`, and on any `401` clears the session and redirects to `/`.
4. `backend/src/middleware/authMiddleware.js` — `protect` verifies the JWT and sets
   `req.practitioner`; `requireRole([...])` gates by role.
5. First-login flow: admin-provisioned accounts get `requires_password_change = true` and a
   temp password; `POST /api/auth/change-password` clears the flag.
6. Self-service reset: `forgot-password` (rate-limited 5/15min) issues a SHA-256-hashed,
   30-minute token via email (Resend); `reset-password` consumes it. Both endpoints return a
   generic success message regardless of whether the email exists (anti-enumeration).
7. **Client-side idle logout**: `App.jsx`'s `IdleLogout` component wipes the session and
   redirects after 15 minutes of no mouse/keyboard/touch/scroll activity — explicitly framed
   as a HIPAA control in the code comments.

### PDF generation pipeline (the core of the app)
Two independent PDF generators, both built on `pdf-lib` (no external PDF service):

1. **NJEIS "SEVF" form filler** (`utils/njeisGenerator.js`, and duplicated logic inline in
   `billingController.generateNJEISForms` / `index.js` / `reportController.generateAuditNJEIS`)
   — loads `backend/templates/NJEIS-020.pdf` (the real state AcroForm PDF), fills text fields
   (patient/practitioner name, DOB, county, up to 10 service rows per page, chunking into
   multiple pages/patients as needed), embeds PNG signatures at hard-coded pixel coordinates,
   flattens the form, and (in the billing controller version) draws the county value as plain
   text over the flattened dropdown field with a white-out rectangle first (a workaround for
   `pdf-lib` not supporting dropdown value rendering cleanly).
2. **Invoice generator** (`utils/invoiceGenerator.js`) — draws a pay-invoice PDF from scratch
   with `pdf-lib` (title, practitioner info, per-visit line items with rate × hours, a
   certification/declaration block, signature line).

Both are uploaded to the Supabase Storage bucket `billing-Invoices` under a
`YYYY-MM/FirstName_LastName/<Type>_<startdate>_<enddate>_<HHMMSS>.pdf` path convention, and
downloaded via short-lived (5-minute) signed URLs — never a public bucket. Download URLs are
validated against a strict filename regex server-side to block path traversal
(`BILLING_FILE_PATTERN` in `billingController.js`).

There is a **second, separate PDF pipeline** used only by the "Reports" tab
(`reportController.generateMasterReport`) that writes to the `njeis-forms` bucket and the
`master_reports` table — see §9.

### Billing state machine (the `assessments.billing_status` column)
```
pending ──(billing generates SEVF)──► njeis_review ──(billing generates invoice)──► invoiced
   │                                        │
   ├──(billing rejects, "return")──► rejected ──(practitioner resubmits)──► pending
   └──(billing rejects, "reject")──► declined ──(practitioner acknowledges, or CEO override)──► invoiced (via issueInvoiceOverride)
```
- `billing_review` column records the admin's last action type (`accept`/`return`/`reject`).
- `rejection_count` increments each time a log is returned/declined.
- `acknowledged_at` / `practitioner_response` / `responded_at` track the practitioner's
  response to a decline.
- `billing_batch_id` links a group of assessments to one `billing_batches` row (created when
  SEVF forms are generated), which stores the resulting `njeis_path` / `invoice_path` in
  storage. This batch linkage is what lets "Send Back to Pending" (`revertBillingBatch`)
  cleanly undo an entire batch — un-stamp the assessments, delete the two PDFs, delete the
  batch row.
- `is_override` flags logs that skipped the normal pipeline via a CEO-issued invoice override.

---

## 5. Data Model (as inferred from the code — no migration files exist in the repo)

### `practitioners`
Columns referenced in code: `id, first_name, last_name, email, password_hash, role,
requires_password_change, is_active, position_title, address, phone_number, pay_rate, ssn,
saved_signature, reset_token_hash, reset_token_expires, created_at`.
- `role` ∈ {`practitioner`, `staff_director`, `billing`, `ceo`}.
- `is_active` implements **soft-delete** (recent commits replaced hard delete with this).
- `ssn` and `pay_rate` are sensitive — the `GET /api/practitioner/profile` endpoint
  explicitly allow-lists returned columns to exclude `password_hash`, `ssn`, `pay_rate`.

### `patients`
Columns: `id, first_name, middle_name, last_name, dob, county, child_id, practitioner_id`.
- `child_id` is validated as an **exactly 9-digit string** (Zod regex, both client and server
  — `patientSchema.js`), matching the official NJEIS Child ID format.
- One-to-one ownership: every patient belongs to exactly one `practitioner_id`; almost every
  patient/assessment endpoint double-checks `.eq('practitioner_id', requesterId)` server-side
  to prevent IDOR (this was a specific fix — see git log "Security & HIPAA hardening").

### `assessments` (the core "encounter/intervention log" table)
Columns: `id, patient_id, practitioner_id`, denormalized patient snapshot
(`patient_first_name, patient_last_name, patient_dob, patient_county`), denormalized
practitioner snapshot (`practitioner_first_name, practitioner_last_name,
practitioner_discipline`), `service_date, start_time, end_time, total_time, status, type,
location, parent_signature, practitioner_signature` (both signatures stored as base64 PNG
data URLs directly in the row — not in Storage), `form_data` (jsonb, currently unused/empty),
plus the billing state-machine columns from §4 (`billing_status, billing_review,
rejection_note, rejected_at, rejection_count, billing_batch_id, is_override, acknowledged_at,
practitioner_response, responded_at`).
- Patient/practitioner fields are **denormalized onto the assessment at write time** rather
  than always joined — presumably so historical logs still display correctly even if a
  patient/practitioner record is later edited or deactivated.

### `billing_batches`
Columns: `id, practitioner_id, start_date, end_date, njeis_path, invoice_path, created_at`.
Created once per "Generate SEVF" action; updated with `invoice_path` once the invoice step
runs; deleted on revert.

### `master_reports` (legacy/parallel table, used only by the Reports tab)
Columns referenced: `id, practitioner_id, patient_id, child_name, date_range, total_hours,
included_assessment_ids (array), njeis_pdf_path, status` (`pending_approval`, presumably other
values elsewhere not seen in this pass). Locks source assessments via a **third**
`billing_status` value, `locked_in_report`, that doesn't appear anywhere in the main billing
pipeline described in §4.

### Service/status/location code vocabularies (hard-coded in `dashboard.jsx`, not DB-enforced)
- **Service type codes**: EV, AS, IFSP, AU, DI, FT, HS, MS, NU, NT, OT, PT, PSY, SLP, SW, VI,
  CC, I/T, ES, TPC (19 codes total — matches the NJEIS service taxonomy).
- **Status codes** (1-5): Ongoing IFSP Service, Practitioner Missed/Cancelled, Family
  Missed/Cancelled, Make-up Service Provided, Compensatory Service Provided.
- **Location codes** (1-8): Home, Residential Facility, Service Provider Clinic/Office,
  Hospital (Inpatient), EC Program (disabilities), EC Program (inclusive community), DCP&P
  Office, Phone/Video Conferencing.

---

## 6. Key End-to-End Workflows

**A. Practitioner logs an intervention**
1. Practitioner selects/adds a patient (`AddPatientModal` → `POST /api/patients/register`,
   Zod-validated both client and server side).
2. Opens `LogInterventionModal`, fills date/time/type/status/location, draws parent +
   practitioner signatures (or reuses a saved default signature).
3. `POST /api/interventions` (defined inline in `backend/index.js`, not in `patientRoutes.js`)
   — ownership-checks the patient belongs to the caller, inserts into `assessments` with
   `billing_status` implicitly defaulting to `pending` at the DB level (not set explicitly in
   this insert — confirm DB default, see Open Questions).

**B. Billing reviews and pays out (the "Billing Manager" / current pipeline)**
1. Billing/CEO opens **Pending Bills** → `GET /api/billing/pending-logs` — logs grouped by
   practitioner, each with a total-hours/total-children summary.
2. Per-log actions: accept (stays pending), **Return** (`billing_status → rejected`, note
   required, practitioner must revise+resubmit) or **Reject** (`billing_status → declined`,
   note required, terminal unless CEO overrides).
3. Billing selects a practitioner + date range, clicks **Generate SEVF** →
   `POST /api/billing/generate-njeis` — fills/merges NJEIS-020 PDF pages per patient, uploads
   to `billing-Invoices`, creates a `billing_batches` row, advances non-rejected logs to
   `njeis_review`.
4. Billing clicks **Generate Invoice** → `POST /api/billing/generate-invoice` — builds the pay
   invoice PDF for `pending`+`njeis_review` logs in range, uploads it, stamps the batch's
   `invoice_path`, advances logs to `invoiced`.
5. Batch now appears in **Completed Bills** (vault). Billing can expand it
   (`GET /api/billing/vault-logs`, scoped by `billing_batch_id`) or, if made in error, **Send
   Back to Pending** (`POST /api/billing/revert-batch`) to undo the whole batch atomically.

**C. Practitioner handles a rejected/declined log**
1. `GET /api/patients/rejected-logs` surfaces un-acknowledged `rejected`/`declined` logs.
2. If `rejected` ("Return"): practitioner edits the log fields and
   `POST /api/patients/resubmit-log` → back to `pending`.
3. If `declined` ("Reject", terminal): practitioner can only
   `POST /api/patients/acknowledge-log`, optionally attaching a response note. A CEO can later
   force-pay it via `POST /api/reports/issue-override` (Master Reports tab), which
   directly sets `billing_status → invoiced, is_override → true` and generates a one-off
   "Override_Invoice" PDF, bypassing the normal SEVF step entirely.

**D. Admin provisions a new staff member**
1. CEO or Office Manager (`staff_director`) fills the registration form → `POST
   /api/auth/register-practitioner`. Server re-validates role rules (Office Manager can only
   create `practitioner` accounts, enforced server-side regardless of what the client sends),
   password strength, and pay-rate requirement for practitioners.
2. New user logs in with the temp password → forced to `/change-password` before reaching
   their portal.

**E. CEO runs an audit** (Reports tab)
`GET /api/reports/audit-logs` — flexible filter query (practitioner name/id, patient name,
date range, billing status, or a "compliance" mode flagging logs >30 days old still stuck in
`pending`/`njeis_review`). Can export a merged NJEIS PDF for the filtered set
(`generateAuditNJEIS`) or a formatted summary PDF table (`generateAuditReportPDF`, built with
raw `pdf-lib` drawing calls — not Puppeteer, despite Puppeteer being in package.json).

---

## 7. Directory / File Map

```
progressive-app-md/
├── Notes.txt                    ⚠ plaintext credentials — see §8 risks, NOT gitignored
├── package.json                 stray root-level file, only dep: react-signature-canvas (dead weight — see §9)
├── backend/
│   ├── index.js                 Express app entrypoint; ALSO contains several inline routes
│   │                            (interventions, practitioner profile/signature, both NJEIS
│   │                            PDF export routes) that duplicate logic found in the
│   │                            organized controllers — see §9
│   ├── findfields.js, makehash.js   ad-hoc dev/debug scripts (not part of the app runtime)
│   ├── templates/NJEIS-020.pdf  the official fillable state AcroForm template
│   └── src/
│       ├── config/db.js         Supabase client singleton
│       ├── middleware/authMiddleware.js   protect / requireRole
│       ├── routes/               authRoutes, patientRoutes, billingRoutes, reportRoutes
│       ├── controllers/          authController, patientController, billingController, reportController
│       └── utils/
│           ├── invoiceGenerator.js  ← LIVE pdf-lib invoice generator (used)
│           ├── pdfGenerator.js      ← DEAD Puppeteer/HTML invoice generator (unused, see §9)
│           ├── njeisGenerator.js    NJEIS PDF filler used by the Reports/Master Reports path
│           ├── patientSchema.js     Zod schema for patient registration
│           └── emailClient.js       Resend wrapper for password-reset emails
└── frontend/
    ├── vercel.json               CSP/HSTS/security headers + SPA rewrite for Vercel hosting
    ├── vite.config.js            "@/" → src alias, Tailwind v4 + React plugins
    └── src/
        ├── App.jsx                Router, role-gated ProtectedRoute, 15-min HIPAA idle-logout
        ├── api/axiosInstance.js   axios instance w/ JWT interceptor + global 401 handler
        ├── pages/
        │   ├── Login.jsx, AdminLogin.jsx           practitioner vs admin login screens
        │   ├── ForgotPassword.jsx, ResetPassword.jsx
        │   ├── dashboard.jsx      practitioner portal (≈878 lines, single-file)
        │   └── AdminDashboard.jsx admin portal shell + role-gated tab switcher
        ├── components/
        │   ├── AddPatientModal.tsx      (one of the few actually-typed files)
        │   ├── LogInterventionModal.jsx encounter logging form + signature capture
        │   ├── SignaturePad.jsx         hand-rolled canvas signature widget
        │   ├── BillingManager.jsx       (≈1121 lines) the billing pipeline UI, admin's largest component
        │   ├── MasterReports.jsx        legacy/parallel audit & reporting UI
        │   ├── InvoiceHistory.jsx       invoice/document history list
        │   ├── AdminReportFetcher.jsx   ⚠ not imported anywhere — dead component, see §9
        │   ├── RegisterPractitionerForm.jsx   staff roster + provisioning UI
        │   ├── ChangePassword.jsx
        │   └── ui/*.tsx                  shadcn/radix primitives
        ├── lib/utils.ts            shadcn `cn()` helper
        └── utils/formatTime.js     24h → 12h AM/PM formatter (duplicated server-side too)
```

---

## 8. Known Risks / Tech Debt

1. **Plaintext credentials in the repo working directory.** `Notes.txt` (repo root) contains a
   Supabase database password and what looks like a JWT bearer token in plaintext, and is
   **not covered by `.gitignore`** (unlike `backend/.env` / `frontend/.env`, which correctly
   are ignored). It currently shows as an untracked (`??`) file in `git status`, meaning it
   has not yet been committed — but nothing stops it from being added by accident. **Action
   needed: delete/relocate `Notes.txt` outside the repo and rotate the Supabase password and
   any JWT/token values it contains, since a plaintext DB password should be treated as
   already compromised.**
2. **Dead code:**
   - `backend/src/utils/pdfGenerator.js` — a full Puppeteer/HTML invoice generator that is
     never imported anywhere; superseded by `invoiceGenerator.js` (per git log, "Replace
     Puppeteer invoice generator with pdf-lib") but never deleted. Puppeteer remains a heavy
     dependency (headless Chromium download) seemingly only for this dead path.
   - `frontend/src/components/AdminReportFetcher.jsx` — not imported by any page/component.
   - Root-level `package.json`/`package-lock.json` with a single dependency
     (`react-signature-canvas`) that isn't imported anywhere in `frontend/src` (the app uses
     its own `SignaturePad.jsx` canvas implementation instead) — looks like leftover
     scaffolding from an earlier signature-library experiment.
   - `backend/findfields.js`, `backend/makehash.js` — standalone debug/dev scripts sitting at
     the backend root, not part of the Express app; unclear if still needed for onboarding
     new templates or generating password hashes ad hoc.
3. **Two parallel billing/reporting pipelines.** The "Billing Manager" tab (pending → SEVF →
   invoice → completed vault, `billing_batches` table, `billing-Invoices` bucket) is the
   actively-developed, current system (essentially all recent commits touch it). The
   "Reports" tab (`MasterReports.jsx` / `reportController.generateMasterReport`,
   `master_reports` table, `njeis-forms` bucket, a **third** `billing_status` value
   `locked_in_report`) looks like an earlier or parallel design that was never fully merged
   into the main pipeline. Both are live and reachable in the UI today, which risks divergent
   behavior/confusion (e.g., an assessment locked via Master Reports wouldn't show up in
   Billing Manager's `pending`/`njeis_review` queries, and vice versa).
4. **Route organization is inconsistent.** Several routes live directly in `backend/index.js`
   (interventions CRUD, practitioner profile/signature, both practitioner- and admin-facing
   NJEIS PDF export endpoints) instead of the modular `src/routes/*` + `src/controllers/*`
   pattern used for everything else. The NJEIS PDF generation logic is essentially
   **duplicated three times** (inline in `index.js` ×2, in `billingController.js`, and again
   in `njeisGenerator.js`/`reportController.js`) with slightly different signature-placement
   coordinates and county-handling logic between them — a bug fixed in one copy will not
   automatically apply to the others.
5. **Mixed `.jsx`/`.tsx` codebase.** TypeScript tooling is fully configured
   (`tsconfig.json`, `@types/react`, etc.) but only a handful of files actually use it
   (`AddPatientModal.tsx`, `lib/utils.ts`, `components/ui/*`). The largest, most complex
   components (`BillingManager.jsx`, `dashboard.jsx`, `AdminDashboard.jsx`) are untyped
   `.jsx`, so most business logic gets no compile-time type safety.
6. **`backend/package.json` lists both `bcrypt` and `bcryptjs`** as dependencies; only
   `bcryptjs` is actually imported. `bcrypt` (native binding) appears to be unused dead weight
   that also complicates cross-platform installs (it needs native compilation; the codebase is
   currently developed on Windows per `PUPPETEER_EXECUTABLE_PATH` pointing at a Windows Chrome
   path in `.env`).
7. **No migrations / schema-as-code.** There is no `migrations/`, Prisma schema, or SQL DDL
   file anywhere in the repo — the entire Supabase Postgres schema exists only as inferred
   from `.select()`/`.insert()` calls in the controllers. Any new engineer has to reconstruct
   the schema by reading Supabase directly (dashboard access needed) or by grepping the
   backend for column names, and there's no version-controlled record of schema changes.
8. **No automated tests found.** No test framework, `__tests__` directories, or CI config
   (no `.github/workflows`) were found anywhere in the repo — all verification is presumably
   manual/production testing.
9. **Signatures stored as base64 in Postgres rows**, not in Supabase Storage — `assessments`
   rows carry full base64 PNG data URLs in `parent_signature`/`practitioner_signature`
   columns. This works but bloats table rows and Postgres backups/replication with binary
   image data that arguably belongs in Storage with a URL reference instead.
10. **User-facing terminology has diverged from code/DB terminology.** A commit renamed
    UI labels ("Pending Workflow" → "Pending Bills", "Completed Vault" → "Completed Bills",
    "NJEIS" → "SEVF") without renaming the underlying code (`billing_status` values,
    `generateNJEISForms`, `njeis-forms` bucket, `NJEIS-020.pdf`, etc. are all still "NJEIS").
    New engineers reading support tickets/user language ("SEVF form") need to know this maps
    to "NJEIS" in the code.

---

## 9. Recent Development Activity (last ~30 commits)

The git history shows a clear arc: **initial build-out of the billing pipeline → UI/UX
polish → a dedicated security/HIPAA hardening pass → a steady stream of billing-pipeline
correctness fixes.** In rough chronological order:

- Early: mobile responsiveness, staff deletion, Render keep-alive, swapping Puppeteer for
  `pdf-lib` in invoice generation.
- Mid: heavy UI/UX iteration on the admin sidebar (hamburger, hover-flyout), Master Reports
  polish, rejected-log UX (practitioner response flow), terminology rename (SEVF/Pending
  Bills/Completed Bills), Child ID becoming a strict 9-digit requirement.
- **`b66278e` "Security & HIPAA hardening: fix PHI IDORs, unauth routes, credential leaks"** —
  a pivotal commit; the ownership-check patterns seen throughout the controllers today
  (`.eq('practitioner_id', requesterId)` on every patient/assessment fetch) and the
  removal of an unauthenticated inline registration route in `index.js` both trace back to
  this.
- Most recent 10 commits are all **billing-pipeline correctness fixes**: invoice date
  formatting / 12-hour time display, fixing SEVF generation when a practitioner's *only* log
  is rejected, forgot-password self-service flow, "Send Back to Pending" batch revert,
  fixing "Completed Bills" expand for practitioners sharing the same name (introduced the
  `billing_batches`/`billing_batch_id` scoping mechanism), removing an unused "Fix Bills"
  backfill feature, **replacing hard-delete with soft-delete (`is_active`) for
  practitioners**, and finally letting admins view/reactivate deactivated practitioners.

**What this suggests about current priorities:** the team has moved past initial feature
build-out and UI polish, and is now in a **stabilization phase on the billing pipeline**
specifically — correctness of the pending → SEVF → invoice → completed-vault state machine,
data integrity when practitioners share names, and safe reversibility of billing actions
(revert-batch) are the recurring themes. Staff lifecycle management (soft-delete/reactivate)
was also just addressed. The "Reports"/Master Reports pipeline and the dead-code items in
§8 have not been touched recently, suggesting they're either low-priority or the owner may
not be aware they've diverged/become dead.

---

## 10. Open Questions / Gaps for a Human to Clarify

1. **Exact Supabase schema, constraints, defaults, and indexes** — no migrations exist; a new
   engineer needs direct Supabase dashboard/SQL access to see real column types, defaults
   (e.g., does `assessments.billing_status` default to `'pending'` at the DB level, since the
   `/api/interventions` insert never sets it explicitly?), foreign keys, and RLS policy status
   (the app connects with a Supabase **service-role** key and does its own authorization in
   Express, so it's unclear whether Postgres Row-Level Security is also enabled as
   defense-in-depth or relied upon at all).
2. **Is the "Reports"/Master Reports pipeline (`master_reports` table, `njeis-forms` bucket,
   `locked_in_report` status) still an actively-used feature, or a candidate for
   deprecation/merge into Billing Manager?** This materially affects data model
   understanding since it's a second source of truth for "this assessment has been billed."
3. **Deployment/ops details not visible from code**: actual Render service configuration,
   environment variable values in production, whether there's a staging environment, how
   `backend/templates/NJEIS-020.pdf` gets updated if the state revises the form, and whether
   Supabase Storage buckets have any lifecycle/retention policy for old invoice PDFs.
4. **Are `bcrypt`, `puppeteer`, `pg`, and the root-level `react-signature-canvas` package
   safe to remove?** They appear unused per this read-through, but a maintainer should
   confirm nothing external (a script, a Render build step, a forgotten route) depends on
   them before pruning.
5. **HIPAA/compliance program specifics** — the code has clear HIPAA-flavored controls
   (rate limiting cited as §164.308(a)(5), 15-minute idle logout, PHI IDOR fixes), but no
   BAA/compliance documentation exists in-repo. Worth confirming with the business owner
   whether there's a compliance checklist this app needs to be measured against.
6. **`Notes.txt` credential rotation** — confirmed as a risk in §8, but whether the exposed
   Supabase password/token have already been rotated since this file was created is unknown
   and should be verified immediately with whoever manages the Supabase project.
7. **Test/QA process** — with no automated tests found, it's unclear whether there's a manual
   QA checklist, a staging Supabase project used for pre-prod testing, or if changes go
   straight from local dev to production.
