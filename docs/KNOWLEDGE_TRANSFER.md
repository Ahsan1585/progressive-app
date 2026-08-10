# Progressive Steps NJ / Izaya EIMS — Knowledge Transfer Document

**Last generated:** 2026-08-10
**Audience:** a new engineer or PM who needs to get productive on this codebase quickly.

This document was produced by reading the actual source in `frontend/`, `mobile/`, and
`backend/`, the git history (~280 commits since the previous pass), and the config files.
Where something could not be determined from the code alone, it is called out in "Open
Questions" at the end.

> **This supersedes the 2026-07-20 version.** The single biggest change since then: the app
> went from **single-tenant** to a **multi-tenant SaaS** (commit `3087a48`, "Multi-tenant
> foundation: per-company database isolation, tenant-aware auth, self-serve signup + trial" —
> already merged into `main`), plus a large new **Compliance Analysis** feature, a dynamic
> per-tenant **roles/permissions** system replacing the old hardcoded 5 roles, **tenant-
> configurable dropdown vocabularies** replacing hardcoded service/status/location codes,
> office↔practitioner **messaging**, mobile **session drafts** and **scheduling with calendar
> invites**, and **subscription/invoice billing** for the SaaS itself. Anything below
> describing a single hardcoded organization is history, not current state, unless explicitly
> marked as such.

---

## 1. Product Overview

**Progressive Steps NJ** (product/engineering codename **Izaya EIMS**, "Early Intervention
Simplified") started as a single-organization tool for one early-intervention therapy agency
operating under **NJEIS (New Jersey Early Intervention System)**, and has since become a
**self-serve multi-tenant SaaS** that any such agency ("company") can sign up for on their
own. Core workflow, unchanged in spirit:

- **Practitioners** (OT/PT/SLP/etc.) log home-visit/clinic sessions with a child, capture
  parent + practitioner signatures on a canvas pad, and submit them — from a desktop browser
  (`frontend/`) or a phone as an installable PWA (`mobile/`).
- **Billing/admin staff** review those logs, generate the state-mandated NJEIS billing form
  (UI label **"SEVF"**), generate a practitioner pay invoice, track the review lifecycle, lock
  a practitioner's row while working it, and export audit reports.
- New since the last doc: staff can now cross-check logged sessions against the state's own
  exported records via **Compliance Analysis** (§9), and office staff can **message**
  practitioners directly in-app (§10).
- Each signed-up company gets its own **isolated Postgres database** (§4) — there is no shared
  data between companies, no `company_id` filtering anywhere in application queries, and no
  cross-tenant visibility except a bare-bones **platform admin** listing (§4.4).

There is no patient/parent-facing portal. There is now a very thin **platform-operator**
surface (list of companies) separate from each company's own admin/billing portal and
practitioner portal (web + mobile PWA).

---

## 2. The Surfaces

### Practitioner Web Portal (`frontend/`, `/dashboard`, role = `practitioner`)
Patient roster, per-patient session history, "Log Session" flow (date, start/end time with a
live **Total Time** pill, tenant-configurable service type/status/location/group-size
dropdowns — see §7 — parent + practitioner signature capture), a reusable saved signature, a
rejected/returned-logs inbox, a quick-stats card, and (new) a **My Invoices** page.

### Practitioner Mobile PWA (`mobile/`, practitioner-only — every other role hits a dead-end
screen)
Separate Vite/React/TypeScript app, installable to a phone home screen:
- **Tabs**: Home, Roster, Inbox, **Messages** (new — office↔practitioner chat, §10),
  Profile.
- **Pushed screens**: add/edit patient, patient detail, log a session (now with **save as
  draft**, §11), resubmit a rejected log, edit a log, manage signature, change password
  (including voluntary change, not just forced), edit contact info.
- Session logging can now also be **scheduled ahead of time** with a calendar invite (§11).
- Auto-refetches each tab's data on every landing; ships as an installable PWA (manifest +
  service worker via `vite-plugin-pwa`), with install prompts from Profile and a first-visit
  banner on the public login page.

### Admin Portal (`frontend/`, `/admin-dashboard`)
Sidebar-driven shell. Tab access is **no longer a hardcoded role→tab map** — it's driven by a
per-tenant, per-role **permission set** (§8). Tabs, roughly matching the old 3 plus additions:
- **Billing** → `BillingManager.jsx` + the newer **Batch Review (beta)**
  (`BillingBatchReview.jsx`), which is now the only Pending Bills layout (legacy table
  removed, `c624d04`). Pending → generate SEVF → generate Invoice → Completed vault, plus
  Invoice Status. Includes per-practitioner row locking (§6) and, inside Batch Review, the
  **Compliance Analysis** and **Compliance Matching** tabs (§9).
- **Staff Directory** → `RegisterPractitionerForm.jsx` — staff roster, provisioning, Service
  Types assignment, profile photo lightbox, Pending Update review (contact-info approval),
  and now also hosts **Action Required** as a third ceo-only sub-tab (`80ea190`, moved out of
  a separate top-level tab) and practitioner **messaging** (§10).
- **Role Management** (new) → `RoleManagement.jsx` — CRUD for custom roles and their
  permission grants (§8). Replaces the old hardcoded role→access table.
- **Company Information** (new) → `CompanySettings.jsx` — three tabs: Company Information
  (name/address/logo/etc.), **EIMS Compliance Reference** (upload the state's Excel, §9),
  and **Dropdown Options** (tenant-configurable vocabularies, §7).
- **Subscription/Billing** (new, ceo-only) → invoice history for the SaaS subscription itself
  (pending/overdue/paid), pay-now / add-payment-method UI (§5).
- **Reports** (`ceo` only, gated by the `master_reports` permission) → `MasterReports.jsx` —
  unchanged in spirit: 5 modules (Practitioner Logs, Patient History, Financial Audit,
  Compliance Flags — a different, older mechanism than the new Compliance Analysis, see §12
  risk #1 — and All Patients), merged audit NJEIS PDF, printable audit report, invoice
  override.
- **Audit Logs** (new) → `AuditLogViewer.jsx`, gated by the `audit_logs` permission — read
  trail over PHI access, deliberately locked down harder than Company Information.

### Platform Admin (new, tiny)
No dedicated frontend UI found in `frontend/src` — a single unauthenticated-by-JWT backend
endpoint (`GET /api/platform-admin/companies`, shared-secret header auth) lists every
company's slug/name/status/trial end date. No suspend/cancel/edit capability yet; explicitly
a placeholder for a future "Phase 3" dashboard.

---

## 3. Tech Stack

**Frontend** (`frontend/`) — unchanged from before: React, React Router DOM, Vite, Tailwind
CSS 4, Shadcn/Radix UI, `react-hook-form` + `zod`, `axios`. Mixed `.jsx`/`.tsx` still, with
most large business components remaining plain `.jsx`. Deployed on Vercel.

**Mobile** (`mobile/`) — unchanged in stack (React + TypeScript, Vite, `vite-plugin-pwa`,
`vitest`, `oxlint`). Deployed on Vercel as a separate project.

**Backend** (`backend/`) — same base (Node.js, Express 5, CommonJS, Google Cloud SQL/Postgres
via `pg`, Google Cloud Storage, `jsonwebtoken`/`bcrypt`, `pdf-lib`, `puppeteer`, `helmet`,
`cors`, `express-rate-limit`, `resend`), deployed on Google Cloud Run — plus:
- **`stripe`** — new dependency, powers subscription billing (§5).
- The database layer is now **multi-tenant** (§4): `backend/src/config/db.js`'s exported
  `pool` is a `Proxy` that resolves to the *current request's* tenant database via
  `AsyncLocalStorage`, so the ~15 pre-existing controllers needed **zero call-site changes**
  to become tenant-aware.

### Stray/untracked files worth cleaning up
A root-level `package.json` (just `react-signature-canvas`), `package-lock.json`, and
`node_modules/` exist at the repo root, untracked and with **no git history at all** — this
looks like an accidental `npm install` run from the repo root instead of `frontend/` or
`mobile/`. Several screenshot PNGs and a `.playwright-mcp/` directory are also untracked at
the root. None of this is part of the shipped app; safe to delete or `.gitignore`, but flag to
the user before deleting anything since it wasn't created by this pass.

---

## 4. Multi-Tenant Architecture (new — the biggest change since the last doc)

Isolation model: **one full Postgres database per company**, not per-schema, not row-level.
There is no `company_id` column anywhere in the tenant schema — the tenant boundary *is* the
database boundary.

### 4.1 The moving pieces
- **`izaya_platform`** database — a small, permanent, PHI-free registry:
  - `companies` — one row per tenant: `slug`, `display_name`, `tenant_db_name`, `status`
    (`trial`/`active`/`suspended`/`cancelled`), `trial_ends_at`, `stripe_customer_id`, BAA
    acceptance fields.
  - `pending_signups` — signups that haven't confirmed their email yet (so an unconfirmed
    signup never consumes a real database).
  - `backend/src/config/platformDb.js` — the pool always connected to this database.
- **Per-tenant database** — a full copy of the original single-tenant schema (`practitioners`,
  `patients`, `assessments`, `company_settings`, `roles`/`role_permissions`,
  `dropdown_categories`/`dropdown_options`, `subscription_invoices`,
  `compliance_state_logs`, etc.), one physical database per company, named
  `tenant_<slug_with_underscores>`.
- **`backend/src/config/db.js`** — the key trick. The exported `pool` is a `Proxy`; every
  property/method access (`pool.query(...)`) resolves `getTenantPool(getCurrentTenantDb())`
  and forwards to the real per-tenant `pg.Pool`. This is what lets existing controllers keep
  doing `const { pool } = require('../config/db')` unchanged.
- **`backend/src/config/tenantContext.js`** — `AsyncLocalStorage`-based (`runWithTenant`,
  `getCurrentTenantDb`) carries "which tenant DB" through the whole async call chain; throws
  if a route reaches a query without tenant context set (fails loudly rather than silently
  hitting the wrong or no database).
- **`backend/src/config/tenantPoolRegistry.js`** — one real connection pool per tenant DB,
  created lazily, max 5 connections/tenant, idle-evicted after 30 min so tenant count can grow
  without exhausting Cloud SQL's connection limit.
- **`backend/src/config/provisioningDb.js`** — a separate elevated pool used only to `CREATE
  DATABASE`/`DROP DATABASE` during signup/rollback (`CREATE DATABASE` can't run inside a
  transaction).
- **`backend/src/config/runMigrations.js`** — on boot, loops every non-cancelled company and
  reapplies a fixed, idempotent migration list to its individual database.

### 4.2 Request routing
Two paths:
1. **Public/pre-auth routes** (login, forgot/reset-password, invite activation) —
   `resolveTenantBySlug` (`backend/src/middleware/tenantMiddleware.js`) reads a `slug` from
   the request body/params, looks it up in `izaya_platform.companies`, rejects unknown/
   cancelled companies, and runs the rest of the request via `runWithTenant`.
2. **Authenticated routes** — the JWT itself carries `slug` and `tenantDb`, set at login
   (`authController.js`'s `loginPractitioner` signs `{ practitionerId, email, role, slug,
   tenantDb }`). `authMiddleware.js`'s `protect` decodes it, re-checks the company's *live*
   `status`/`trial_ends_at`/`baa_accepted_at` from `izaya_platform` on every request (never
   trusts the up-to-24h-old JWT for that), then wraps the rest of the request in
   `runWithTenant(decoded.tenantDb, ...)`.

Tenant is identified by a **company code/slug the user types**, not by subdomain or header —
`Login.jsx`'s form posts `{slug, email, password}` and persists the slug to `localStorage`.

A **BAA acceptance gate** lives in the same middleware: if `baa_accepted_at` is null on the
company, every PHI-touching route 403s except accept-BAA and company-status.

### 4.3 Self-serve signup + trial
Two-step, email-confirmation-gated (`backend/src/controllers/signupController.js`,
`POST /api/signup` then `POST /api/signup/confirm/:token`):
1. **Request** — validates slug (lowercase/digits/hyphens, reserved-word blocklist), company
   info, CEO account, BAA acceptance; upserts a `pending_signups` row with a hashed 24h
   confirmation token; emails a confirm link. **No database is created yet.**
2. **Confirm** — `CREATE DATABASE "tenant_<slug>"`, applies `backend/db/schema.sql` + the
   fixed migration list, seeds `company_settings`, seeds the fixed `Admin` role plus 4
   prebuilt starter roles (`Account Specialist`, `Billing Specialist`, `Program Coordinator`,
   `Staff Director`), creates the CEO's `practitioners` row, and **only as the last step**
   registers the company in `izaya_platform.companies` with `status='trial'` and
   `trial_ends_at = now() + 15 days`. Any failure mid-provisioning triggers best-effort
   cleanup (`DROP DATABASE IF EXISTS`).

**Trial**: 15 days, no card required. At expiry, every route 402s except the CEO's
subscription-billing routes (so they can add a payment method) — computed fresh per request,
not cached in the JWT. `TrialStatusBanner.jsx` polls `GET /api/auth/company-status` and shows
an amber "N days left" banner, then a red "trial ended" banner.

### 4.4 Platform admin
Deliberately minimal: `GET /api/platform-admin/companies` (shared-secret header
`x-platform-admin-key`, **not** JWT/role auth) lists `slug, display_name, status,
trial_ends_at, created_at` — no PHI, no manage actions. Comment in the code explicitly flags
this as not a real admin auth system yet.

### 4.5 What is NOT tenant-scoped by a filter column
No table anywhere has a `company_id` column, and no query has a `WHERE company_id = ...`
guard — isolation is 100% structural (separate databases), not row-level. A new engineer
should **not** go looking for tenant-scoping logic inside feature controllers (billing,
compliance, patients, etc.) — none exists or is needed under this architecture, and none would
help if the architecture ever changed to a shared database.

---

## 5. Subscription Billing (new — billing for the SaaS itself, distinct from NJEIS billing)

`backend/src/utils/subscriptionBilling.js` + `backend/src/controllers/subscriptionController.js`,
Stripe-backed, tracks each company's own subscription invoices in `subscription_invoices`
(per-tenant table) with lifecycle `pending → overdue → paid` (also `failed`).

- Billing periods are calendar months computed in **US Eastern time** to avoid Cloud Run's
  UTC rollover drift.
- `closePeriodInvoice` creates the period's invoice and attempts an off-session Stripe charge
  if a default payment method is on file.
- Due date = the 15th of the following month. `markOverdueInvoices` flips
  `pending`/`failed` → `overdue` once past due — run **lazily on every read** (self-correcting
  regardless of scheduler health) *and* by a scheduled sweep.
- **Schedulers**: `POST /api/subscription/invoices/run-scheduled` (monthly close) and
  `POST /api/subscription/invoices/mark-overdue` (redundant/optional overdue sweep) — both
  intended as Cloud Scheduler targets, both loop every `trial`/`active` company from
  `izaya_platform` and run the work inside `runWithTenant(...)` per tenant so one tenant's
  failure doesn't block the others. Auth is a shared-secret `X-Cron-Secret` header (fails
  closed if `CRON_SECRET` is unset) — no user session, since Cloud Scheduler has none.
- A Stripe webhook also flips invoice status on `payment_intent.succeeded`/`.payment_failed`.
- ceo can `payInvoice`/`payAllOutstanding` manually from the Subscription/Billing admin tab.

**Do not confuse this with NJEIS billing** (§ below, unchanged core feature) — this is the
SaaS's own revenue billing for using the app; NJEIS billing is the practitioner-pay/state-form
pipeline that is the product's actual purpose.

---

## 6. Billing row locking, PDF pipeline, billing state machine (unchanged since last doc)

These are **unchanged in mechanism** from the 2026-07-20 doc — still tenant-scoped
automatically by database isolation, no logic changes found:

- **Per-practitioner row locking** on Pending Bills (`billing_locks` table) — lock/unlock/
  force-release-by-ceo, auto-release on invoice issuance, inline lock state in
  `GET /api/billing/pending-logs`.
- **PDF generation pipeline** — `njeisGenerator.js` (SEVF/NJEIS-020 filler), `invoiceGenerator.js`
  (pay invoice), `invoiceStamper.js` (Puppeteer printed/paid stamping). Still duplicated across
  `index.js`/`billingController.js`/`reportController.js` (see §12 risk #2).
- **Billing state machine** on `assessments.billing_status`: `pending → njeis_review →
  invoiced`, with `rejected`/`declined` branches and CEO override — same as before.

---

## 7. Tenant-Configurable Dropdown Vocabularies (new — replaces hardcoded codes)

The old doc's claim that service/status/location codes are hardcoded in `dashboard.jsx` is
**obsolete**. They are now tenant-owned rows:
- `dropdown_categories` (`key`, `display_name`, `is_custom`, `is_required_on_log`,
  `sort_order`, `is_active`) — built-ins (`service_type`, `service_status`, `location`,
  `group_size`) have `is_custom=false` and cannot be edited/deleted; a tenant can add its own
  custom categories on top.
- `dropdown_options` — the actual selectable values per category.
- Managed via Company Information → **Dropdown Options** tab (`DropdownOptionsManager.jsx`),
  backend `backend/src/controllers/dropdownCategoriesController.js`, gated by the
  `company_info_dropdown_options` permission.
- **Caching**: `backend/src/constants/dropdownOptionsCache.js` is keyed **per tenant**
  (there's no tenant context at process boot), refreshed synchronously on any admin write, and
  additionally self-heals via a 30s TTL because Cloud Run can run multiple instances and a
  write on one doesn't propagate to another's in-memory cache.
- Mobile (`AppDataContext.tsx`) fetches `/api/dropdown-options` and
  `/api/dropdown-options/categories` on load and derives all its option lists from them — no
  hardcoded option constants remain in the mobile app either.
- Deleting a custom category is blocked if a Compliance Analysis custom field still references
  it via `compareTo` (§9).

---

## 8. Dynamic Roles & Permissions (new — replaces hardcoded 5-role model)

The old hardcoded `practitioner`/`staff_director`/`billing`/`ceo`/`account_specialist` model
is gone as the primary access-control mechanism, replaced by a per-tenant, fully-editable
**roles table**, though two legacy pivot points remain hardcoded:

- **Permission catalog**: a fixed 13-key list in `backend/src/constants/permissions.js`
  (`staff_directory_view/edit/edit_role`, `register_new_user`, `master_reports`,
  `billing_pending/completed/invoice_status`, `subscription_billing`,
  `company_info_compliance_doc/dropdown_options`, `audit_logs`,
  `action_required_approve`). Adding a new permission requires updating this list **and**
  wiring a matching `requirePermission(...)` call somewhere — one without the other is a
  no-op.
- **Every tenant gets**, seeded at signup: one fixed, non-editable, full-access **`Admin`**
  role (`roles.is_system = true`) plus 4 freely-editable starter roles (`Account Specialist`,
  `Billing Specialist`, `Program Coordinator`, `Staff Director`), each granted
  `staff_directory_view` by default.
- **`RoleManagement.jsx`** (new admin tab) — create custom roles, toggle any of the 13
  permission checkboxes, delete unused roles. The system `Admin` role always renders
  read-only.
- **Guardrails**: a tenant can never end up with zero active Admins — self-demotion is
  blocked, and only an existing Admin can grant Admin.
- **Legacy pivots still hardcoded**: the `role` column's two special string values `'ceo'`
  (full admin, no DB lookup needed) and `'practitioner'` (no office-portal access, no DB
  lookup needed) are still fast-pathed throughout the codebase — login JWT payload, billing
  seat-counting for subscription pricing, `requireOfficeStaff` gating, etc. Any *other*
  `role` value looks up its real permission set by joining `practitioners.role_id → roles →
  role_permissions`.

**Practical implication for a new engineer**: gating a new feature by role is done via
`requirePermission('<key>')` (backend) and reading permission flags from the auth context
(frontend), not by checking `role === 'billing'` etc. — except for the two hardcoded `ceo`/
`practitioner` special cases, which remain literal role checks.

---

## 9. Compliance Analysis (new — the largest single feature added, ~35 commits)

**Purpose**: NJEIS (the *state's* own system — see terminology note below) exports its own
record of every EI session a practitioner delivered, as an Excel "Service Log Report." This
feature cross-checks that export against the practitioner's own session logs stored in this
app, so billing/admin staff catch discrepancies (wrong service type, location, group size,
times, missing sessions, duplicate submissions) before invoicing or state submission, rather
than after a claim gets rejected.

### 9.1 Where it lives
- **Reference file upload** — Company Information → **"EIMS Compliance Reference"** tab
  (`CompanySettings.jsx`). Upload → column-mapping review (auto-detects headers; a custom
  field can optionally be tied to compare against a tenant's own real field or a custom
  dropdown category) → confirm parses the file into `compliance_state_logs`.
- **The actual comparison** — Billing → **Batch Review (beta)** → per-practitioner detail →
  **Compliance Analysis** tab (`ComplianceAnalysisPreview` in `BillingBatchReview.jsx`) and a
  sibling **Compliance Matching** tab (strictness setting + a table of every learned rule with
  a delete button).
- **Backend engine** — `backend/src/controllers/billingController.js`'s
  `getComplianceAnalysis`/`computeSessionCompliance`, built on
  `backend/src/constants/njeis.js` (label→code mapping + strictness profiles) and
  `backend/src/utils/textMatch.js` (fuzzy text matching).
- **Learning engine** — `backend/src/controllers/complianceLearningController.js`.

### 9.2 Data model (per-tenant, since this app is fully database-isolated per company)
- `company_settings` — singleton row (`id=1`) holds the uploaded file's GCS path/metadata,
  confirmed column mapping (jsonb), custom-field definitions (jsonb), removed-field list
  (jsonb), a frozen month-by-month analysis snapshot (jsonb, §9.6), and the
  `compliance_strictness` setting (`strict`/`moderate`/`lenient`, ceo-editable).
- `compliance_state_logs` — one row per state-recorded session, parsed from the Excel. Started
  as a **single-snapshot table** (wiped and replaced on every upload — a bug, since reviewing
  an older still-open billing period would lose its reference data on a newer upload); now a
  **rolling window**: each upload only replaces its own covered date range, and both upload
  and every read lazily purge rows older than **90 days** (widened from 60).
- `compliance_match_overrides` — the "learned vocabulary": one row per confirmed
  `(field, state's raw text, our value)` pairing, auto-matches on every future run.
- `compliance_field_acknowledgments` — one-off "allow just this log" records, also doubling as
  the audit trail for a learnable field's first confirmation; cleared when a log goes back to
  Pending.

### 9.3 Matching engine (concretely)
- **Session pairing key**: `patient_id + service_date`. When multiple sessions share a day, a
  scoring function penalizes time mismatches (with a large penalty when one side has no time
  at all, so a cancelled/null-time session can't steal a real candidate), then an **optimal
  one-to-one assignment across the whole same-day group** (not first-come-first-served —
  order-dependent cross-pairing was a real bug that got fixed) picks the best pairing, falling
  back to greedy only for pathologically large groups.
- **Fields compared**: Child ID, Child Name, Practitioner Name, Service Date (join key, always
  matches), Start/End Time, Service Type, Location, Group Size Category, Logged Date, IFSP
  Event ID (informational only), plus any admin-defined custom fields. Unmapped columns are
  hidden entirely rather than shown as always-flagged.
- **Fuzzy text matching**: normalize (lowercase, strip punctuation, collapse whitespace), then
  order-independent Jaccard word-set similarity so "Last, First" vs "First Last" and minor
  wording differences pass at a tunable threshold.
- **Strictness profiles**: `strict` (exact match, 0 min tolerance), `moderate` (66% word
  overlap, 2 min tolerance — default), `lenient` (50% overlap, 5 min tolerance).
- **Zero-duration exemption**: a cancelled/zero-duration log auto-matches on every field —
  nothing to reconcile.
- **Custom fields**: informational by default; can be bound (`compareTo`) to one of our real
  fields (service type, location, group size, service status, discipline, patient
  county/DOB, total time) or to one of the tenant's own custom dropdown categories, turning it
  into a real match/mismatch check.
- **Duplicate detection**: a session that loses the same-day group assignment is checked
  against other already-matched sessions with identical patient/date/time/type/location — if
  found, it's labeled a duplicate rather than "Missing in EIMS."

### 9.4 The self-improving/learning loop
When billing clicks **"Allow"** on a flagged field:
1. Always records a per-log acknowledgment (unblocks Approve for that one log regardless of
   field type).
2. If the field is one of the "learnable" ones (Child Name, Practitioner Name, Service Type,
   Location, Group Size, or a custom field bound to a real bounded vocabulary — **not** IFSP
   Event ID or unbound free-text custom fields) **and** the two values share at least one word
   (the signal this is a labeling/formatting variant, not a genuinely different value), it also
   upserts a learned rule into `compliance_match_overrides` — every future log with that exact
   `(field, state's text, our value)` pairing auto-matches from then on, regardless of
   strictness. Learned rules are visible and individually deletable in the Compliance Matching
   tab.

### 9.5 Reviewer workflow (top to bottom in the UI)
Reference-doc banner (attached filename, downloadable) → manual re-run button → **clickable
stat-card filters** (Sessions Checked / Match with State / Flagged / Missing in EIMS) →
per-session comparison cards (Our Log vs EIMS Record, red-X/amber-learned/green-match per
field, "Allow" button on any mismatch) → duplicate-log handling → **"Missing in EIMS"** flow
(billing sends to admin for approval; admin reviews with a required comment and Approve/
Reject) → per-card status dropdown (Approve/Reset/Return/Reject/Hold) → **auto-approval of
clean matches** (billing never has to click Approve for a session that's matched and
unflagged — only exceptions need a click) → scroll-position sync with the practitioner queue
on the left.

### 9.6 Month-by-month data summary
A **frozen snapshot** (not a live query), stored in `company_settings.compliance_doc_analysis`,
recomputed automatically every time an upload's column mapping is confirmed, and manually
refreshable via a button — because the 90-day rolling purge happens silently in the
background, this table (Month | Records | Earliest/Latest date, "As of {date}") is the only
way for staff to see what's actually currently on file without querying the database.

### 9.7 Terminology note — "EIMS" naming collision
Commit `a1a44c0` renamed "state document/records" → **"EIMS"** throughout this feature's UI
("State Record" column → "EIMS Record", "No state document on file" → "No EIMS records on
file," etc.), to match how practitioners/admins colloquially refer to **New Jersey's own
state-run Early Intervention Management System** — the external system whose export is being
compared against. **This is a different "EIMS" from the product's own name, "Izaya EIMS."**
Within this app, "EIMS" now ambiguously means either the product itself or the external state
system depending on context (e.g. "No matching record found in EIMS" refers to the *state's*
system). New engineers should not conflate the two; a more specific future label (e.g. "State
EIMS" or "NJEIS") would remove the ambiguity.

### 9.8 Multi-tenant scoping
No `company_id` scoping exists or is needed here — every compliance table lives inside each
tenant's own isolated database, same as everything else (§4.5). This feature was built
assuming a single-org-per-database schema and happens to be tenant-safe purely because of the
database-per-tenant architecture underneath it, not because anyone added scoping logic to it.

---

## 10. Office↔Practitioner Messaging (new)

`backend/src/routes/messageRoutes.js` / `messageController.js` — simple threaded messaging,
one thread per practitioner (`getThreads`/`getThread`/`postMessage`/`getUnreadCount`).
Office-side access requires `requireOfficeStaff` (any non-`practitioner` role); a practitioner
can only see/post to their own thread. Originally its own top-level tab
(`MessageCenter`), later folded into **Staff Directory** as a section
(`5f423ff`/`2467904`) alongside visibility-aware polling for unread counts. On mobile, exposed
as its own **Messages** tab.

---

## 11. Mobile Session Drafts & Scheduling (new)

- **Save as draft** (`f85233e`) — `backend/src/routes/sessionDraftsRoutes.js` /
  `sessionDraftsController.js`: `POST`/`GET`/`GET :patientId`/`DELETE :patientId`, one draft
  per `(practitioner, patient)`, letting a practitioner start a session log on mobile and
  finish it later without losing data.
- **Scheduling with calendar invites** (`17a347b`) —
  `backend/src/routes/scheduleRoutes.js` / `scheduleController.js`: any practitioner can
  create/update/cancel a scheduled session for their own patients (ownership enforced in the
  controller, not via `requireRole`), and `backend/src/utils/icsGenerator.js`
  (`buildSessionICS`) generates a `.ics` calendar invite — presumably emailed or downloadable
  to the parent, worth confirming the exact delivery mechanism if picking up this code (see
  Open Questions).

---

## 12. Known Risks / Tech Debt (updated)

Carried forward from the previous doc where still true, plus new items from this pass:

1. **Two parallel billing/reporting pipelines** *and now effectively a third compliance
   mechanism.* The "Billing Manager"/Batch Review pipeline (pending → SEVF → invoice →
   completed, `billing_batches`) is the actively-developed system. "Reports" tab
   (`MasterReports.jsx`) is an older/parallel design with its own **"Compliance Flags"**
   module — this predates and is **unrelated to** the new Compliance Analysis feature (§9),
   despite the very similar name. A new engineer investigating a "compliance" bug report
   should confirm which of the two the user means.
2. **Route/logic duplication for NJEIS PDF generation** — unchanged: logic is essentially
   duplicated across `index.js`, `billingController.js`, and `njeisGenerator.js`/
   `reportController.js` with slightly different signature-placement/county-handling.
3. **Mixed `.jsx`/`.tsx` on the web app** — unchanged; most large business components
   (`BillingManager.jsx`, `dashboard.jsx`, `AdminDashboard.jsx`, `BillingBatchReview.jsx`)
   remain untyped `.jsx`.
4. **No migrations framework in the traditional sense** — there IS now a fixed, idempotent
   migration list (`runMigrations.js`) applied to every tenant on boot and at signup-time
   provisioning, which is a real improvement over the old "hand-run SQL, update schema.sql by
   hand" model. But `backend/db/schema.sql` is still the base template applied at signup, and
   any schema change still requires (a) writing a migration file, (b) adding it to the fixed
   migration list, and (c) keeping `schema.sql` in sync for brand-new tenants — three places
   to update by hand, easy to miss one.
5. **No automated tests on `frontend/`/`backend/`** — unchanged; only `mobile/` has `vitest`.
6. **Signatures/profile pictures stored as base64 in Postgres rows**, not Cloud Storage —
   unchanged.
7. **"EIMS" terminology now genuinely ambiguous within Compliance Analysis** — see §9.7. Not
   present in the 07-20 doc because the rename hadn't happened yet.
8. **Stray root-level `package.json`/`package-lock.json`/`node_modules`** — untracked, no git
   history, looks like an accidental `npm install` from the repo root. Confirm with the team
   and clean up (do not delete unilaterally without confirming it isn't in-progress work).
9. **Platform admin has no real auth** — a bare shared-secret header, explicitly called out in
   code comments as not production-grade; fine for the current single-operator phase but
   should not be treated as a real access-control boundary.
10. **Dev/seed endpoints exist but are flag-gated** — `backend/src/routes/testDataRoutes.js`
    only wires up `/seed-comparison-test-data`, `/wipe-all-seed-data`,
    `/hard-delete-practitioner`, `/randomize-seed-*`, and a read-only
    `/debug-compliance-state-logs` when `ENABLE_TEST_SEED=true` is set on the backend, and
    they're `ceo`-only on top of that. **Confirm this env var is unset in production** before
    assuming these are inert — they mutate/delete real data if enabled.
11. **`billing_invoices` table is dead** — unchanged, superseded by `billing_batches`.
12. **Supabase/Render migration residue** — status not re-verified this pass; see the previous
    doc's open questions if picking this up (likely still applies, was not core to this
    investigation).

---

## 13. Recent Development Activity (this pass — since 2026-07-20)

The arc: **multi-tenant SaaS conversion (signup, trial, per-company isolation, subscription
billing) → dynamic roles/permissions and tenant-configurable dropdowns → the Compliance
Analysis feature (upload, matching engine, learning loop, UI workflow) → office↔practitioner
messaging → mobile session drafts and scheduling with calendar invites → EIMS terminology
cleanup and login-page polish.**

Roughly (most-recent-first, grouped rather than commit-by-commit given ~280 commits):
- Real app screenshots replaced CSS-animated demos on the login page (most recent).
- EIMS terminology rename across Compliance UI; month-by-month reference-data summary.
- A string of seed/dev-endpoint hardening fixes (compliance-aware wipe, signature/address
  randomization for test data).
- Compliance Analysis matching refinements: order-dependent duplicate cross-pairing fix,
  90-day retention window, custom-field-teaches-the-system learning, custom dropdown
  categories as compareTo targets, scroll-sync with the practitioner queue.
- Compliance Analysis feature build-out from scratch: upload UI → real matching engine →
  stats/badges/review workflow → self-improving matching → duplicate detection → rolling
  window retention.
- Mobile: session log drafts.
- Batch Review beta made the sole Pending Bills layout (legacy table removed).
- Compliance reference retention window and cross-pairing fixes.
- (Earlier in this window, not itemized individually here — see `git log` directly for the
  full 280-commit list): the multi-tenant foundation merge itself, dynamic roles/permissions,
  tenant-configurable dropdowns, subscription/invoice billing + schedulers, office↔
  practitioner messaging, mobile session scheduling with calendar invites, Action Required
  workflow improvements.

**What this suggests about current priorities**: the team shipped the multi-tenant/SaaS
conversion as foundational infrastructure, then immediately built Compliance Analysis as the
flagship new feature on top of it, with heavy iteration (35+ commits) suggesting active,
close collaboration with real billing-staff usage/feedback. Messaging and mobile scheduling
look like secondary, smaller feature adds alongside that main thread. The legacy "Reports" tab
and its own Compliance Flags module have not been touched.

---

## 14. Open Questions / Gaps for a Human to Clarify

1. **Is the legacy "Reports" tab's "Compliance Flags" module being deprecated** now that the
   real Compliance Analysis feature exists, or are both intentionally kept as independent
   checks? The naming collision alone (§12 risk #1) makes this worth resolving explicitly.
2. **What actually happens with the generated `.ics` calendar invite** from mobile session
   scheduling (§11) — is it emailed to the parent, downloaded by the practitioner to share
   manually, or something else? Not fully traced this pass.
3. **Is `ENABLE_TEST_SEED` confirmed unset in the production Cloud Run service** (§12 risk
   #10)? These endpoints can wipe/mutate real data if left on.
4. **Platform admin roadmap** — is a real management UI (suspend/cancel a company, view
   subscription health across tenants) planned soon, or is the single `list companies`
   endpoint sufficient for now?
5. **Root-level stray `package.json`/`node_modules`** (§12 risk #8) — confirm with the team
   whether this is safe to delete or represents in-progress work before removing it.
6. **Supabase/Render migration status** — not re-verified this pass; carry forward the
   previous doc's open question if relevant to current work.
7. **Stripe integration details not fully traced**: webhook endpoint security (signature
   verification?), what happens to a tenant's data/access on `cancelled` status, and whether
   there's a way to change plans/pricing per tenant or if pricing is currently fixed.
8. **Deployment/ops details still not fully visible from code**: exact Cloud Run service
   config for the multi-tenant backend, whether the migration-on-boot (`runMigrations.js`)
   has caused any startup-time slowness as tenant count grows, and whether there's a staging
   environment with its own `izaya_platform`.
