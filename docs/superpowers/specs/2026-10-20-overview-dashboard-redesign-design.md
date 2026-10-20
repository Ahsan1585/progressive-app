# Overview Dashboard Redesign — Design

## Context

The CEO/admin "Overview" tab (`frontend/src/components/CompanyDashboard.jsx`, backed by `backend/src/controllers/dashboardController.js`) already implements a working Day/Month/Year + Accounts Payable dashboard, built per an earlier plan (`~/.claude/plans/similar-to-how-we-snazzy-mist.md`). The user asked for this page to be redesigned to match a reference design viewed via two screenshots of `https://care-notes-to-claims.lovable.app` ("Session to payment" digital backoffice dashboard).

The reference is structurally very close to what already exists — same underlying concepts (held/owed/sessions KPIs, a session→invoice→state-match→paid pipeline, an EIMS match donut, a practitioner accuracy table, a returned/flagged-sessions list) — just restyled with a cleaner, more polished visual language. Two things in the reference are genuinely new: a "Services provided" category breakdown and an "Invoices & SEVF forms" document feed. A third thing, a "Customize" button enabling drag-to-reorder of the dashboard's cards, was also requested by the user as a capability to add (not present in the current dashboard, and only implied — not literally shown — in the reference's "Customize" button and the screenshot's keyboard-accessible-dragging hint text).

The user confirmed, via explicit approval: build the visual restyle, both new data sections, and the drag-to-reorder capability, all in this one pass. Also confirmed: the "Services provided" breakdown uses the same month as the rest of the dashboard's `MonthYearPicker` (not always-current-month), and drag-to-reorder layout is saved per viewer (not company-wide shared).

**This page is office-staff-only** (CEO, billing staff, other back-office roles with the `master_reports` permission — see `dashboardRoutes.js`'s existing `dashboardGuard`), never a clinical practitioner's own view. `practitioners` is this app's single logins table for every role, clinical and office alike, so "per viewer" below means per logged-in office-staff user (identified by `req.practitioner.practitionerId`, the same identity field every request already carries regardless of role) — not "per clinical practitioner" delivering sessions. The rest of this spec says "per viewer" rather than "per practitioner" to keep that distinction unambiguous.

## Goals

1. Restyle every existing dashboard section to match the reference's visual language: dark navy/charcoal gradient hero banner with a right-aligned horizontal progress bar; stat cards with small circular colored icon badges; thin clean progress bars for the billing pipeline; a simplified EIMS match ring; a practitioner accuracy table with thin bars + discipline subtitles; a returned-logs list with colored left-border tags.
2. Add a "Services provided" section: this month's (per the `MonthYearPicker`) session counts broken down by Service type / Status / Location / Discipline, switchable via a segmented tab control, shown as a proportional stacked bar plus a legend with per-category counts.
3. Add an "Invoices & SEVF forms" section: a feed of the most recently generated billing documents (invoice or SEVF), each showing a document number, practitioner name, session count, dollar amount, and a Matched/Pending/Mismatch status chip.
4. Add a "Customize" capability: a button that toggles drag-to-reorder on the dashboard's section cards (the hero banner and KPI stat row stay fixed; everything below becomes reorderable). Each admin's chosen order persists per-practitioner, so it survives reloads and follows them across devices.

## Non-goals

- No change to the underlying Day/Month/Year/AP computation logic already in `dashboardController.js` — this redesign is additive (new endpoints) and cosmetic (restyled existing components), not a rewrite of existing business logic.
- No scheduling, IFSP authorization dates, enrollment/age-out tracking, or anything else this app's schema doesn't already capture — same constraint as the original dashboard plan.
- No reordering of the hero banner or KPI stat row — those stay fixed as the page's "key summary," matching how the reference's own month-selector/header area is not draggable.
- No company-wide shared layout — out of scope per the user's explicit choice of per-admin layouts.
- No redesign of the Day/Month/Year "Where this is headed" trajectory tabs' internal charts (BarChart/AreaChart) beyond color-token alignment — the reference screenshots don't show year/trend charts in enough detail to redesign them confidently, and the user's screenshots are of the Month-equivalent default view only.

## Architecture

```
backend/src/controllers/dashboardController.js
  + getServicesBreakdown   GET /api/dashboard/services?month=YYYY-MM
  + getDocumentsFeed       GET /api/dashboard/documents
  + getDashboardLayout     GET /api/dashboard/layout
  + saveDashboardLayout    PUT /api/dashboard/layout

backend/db/migrations/add_dashboard_layouts.sql
  CREATE TABLE dashboard_layouts (practitioner_id, section_order jsonb, updated_at)

frontend/src/components/CompanyDashboard.jsx
  - restyle: VerdictBanner, StatCard, BillingFunnel, EimsDonut,
    PractitionerAccuracyTable, ReturnedLogsPanel, ActionQueue
  + new: ServicesBreakdown (tabs + stacked bar + legend)
  + new: DocumentsFeed (invoice/SEVF list)
  + new: CustomizeToggle + SectionGrid (drag-to-reorder wrapper)
```

All four new endpoints reuse the existing `dashboardGuard` (`protect, loadPermissions, requirePermission('master_reports')`) already applied to every `/api/dashboard/*` route in `dashboardRoutes.js` — the same office-staff-only gate, not reachable by a clinical-practitioner login even if they somehow had a `master_reports` permission grant (role-appropriate permission catalogs are enforced elsewhere in this app's permission system, outside this spec's scope) — and rely on the same `AsyncLocalStorage`-based tenant scoping every other controller already gets for free via `pool.query`.

## Backend design

### `getServicesBreakdown(req, res)` — `GET /api/dashboard/services?month=YYYY-MM`

Reuses `parseMonthParam` (already in `dashboardController.js`) for the month window. Runs four cheap `GROUP BY` queries against `assessments` for the selected month — no compliance checks needed, so this is inexpensive even on a large month:

- **Service type**: `GROUP BY type` on `assessments`, resolved to labels via the existing `serviceCodeLabel` helper (`backend/src/constants/njeis.js`, already used throughout `billingController.js`/`invoiceData.js`).
- **Status**: `GROUP BY billing_status`, labeled via a small local map (`pending` → "Pending review", `njeis_review` → "In EIMS review", `invoiced`/`completed` → "Invoiced", `on_hold` → "On hold", `rejected`/`declined` → "Returned", `self_certified` → "Self-certified") — the same statuses `getMonthOverview`'s `statusFunnel` already buckets, just relabeled for a breakdown chip rather than a funnel stage.
- **Location**: `GROUP BY location`, resolved via the existing `locationCodeLabel` helper.
- **Discipline**: joins `assessments.practitioner_id` to `practitioners.position_title` and groups by that — same field the Staff Directory care-team chips already use for "discipline," not `service_types` (that distinction was a real bug fixed earlier in this app's history; this endpoint must not repeat it).

Each dimension returns `[{ key, label, count }]` sorted by count descending, capped to the top 6 with any remainder folded into an "Other" bucket (keeps the stacked bar and legend readable regardless of how many distinct service/location codes a tenant has configured). Response shape:

```json
{
  "success": true,
  "month": "2026-10",
  "byServiceType": [{ "key": "DI", "label": "Developmental Intervention", "count": 341 }, ...],
  "byStatus": [...],
  "byLocation": [...],
  "byDiscipline": [...]
}
```

### `getDocumentsFeed(req, res)` — `GET /api/dashboard/documents`

Returns the most recent `billing_batches` rows (`ORDER BY created_at DESC LIMIT 20`), each enriched with:

- **Document number**: `formatInvoiceNumber(batch.id)` (already exported from `invoiceData.js`) — reused as-is, including for SEVF-labeled rows, since there is no separate SEVF record in the schema; a batch for an `independent_practitioner` role is simply labeled `"SEVF"` instead of `"Invoice"` in the response, while the number format itself stays identical (ties back to the same `billing_batches` row either way).
- **Practitioner name** and **role** (for the Invoice/SEVF label) via a join to `practitioners`.
- **Session count** and **total $**: `COUNT(*)` / `SUM(total_time/60 * pay_rate)` over `assessments` where `billing_batch_id = batch.id`, same per-line math `invoiceData.js` already uses elsewhere.
- **Status chip**: computed by loading each batch's assessment lines through the existing `loadComplianceForLines` + `deriveEimsStatus` pipeline (same pattern `getAccountsPayable`/`getMonthOverview` already use), then rolling the per-line tiers up to one batch-level tier with "worst wins": any line `exception` → batch is **Mismatch**; else any line `pending`/`unverified` → batch is **Pending**; else (all lines `cleared`) → batch is **Matched**. This mirrors the existing rule elsewhere on this dashboard that a human hold/exception always overrides a cleaner-looking aggregate.

Response shape:

```json
{
  "success": true,
  "documents": [
    {
      "batchId": "a1b2c3d4-...",
      "documentNumber": "INV-A1B2C3D4",
      "documentType": "invoice",
      "practitionerName": "Aiden Holt",
      "sessionCount": 11,
      "amount": 2035.00,
      "status": "matched",
      "createdAt": "2026-10-14T10:03:00Z"
    }
  ]
}
```

`status` is one of `matched` / `pending` / `mismatch`, mapped client-side to the same teal/amber/red tokens used everywhere else on the redesigned dashboard.

### `getDashboardLayout` / `saveDashboardLayout` — `GET`/`PUT /api/dashboard/layout`

New table, via `backend/db/migrations/add_dashboard_layouts.sql`:

```sql
CREATE TABLE dashboard_layouts (
  practitioner_id integer PRIMARY KEY REFERENCES practitioners(id),
  section_order jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

The FK is to `practitioners(id)` because that's this app's single logins table for every role — but only office-staff logins (gated by `dashboardGuard`, see above) ever reach the endpoints that read/write this table, so in practice every row here belongs to a CEO/billing/back-office viewer, never a clinical practitioner. `section_order` is a plain JSON array of section keys, e.g. `["pipeline", "action_queue", "services", "eims_donut", "practitioner_accuracy", "documents", "returned_logs"]`. The full, fixed set of valid keys is defined once as a constant in both the controller and the frontend (`DASHBOARD_SECTION_KEYS`), so a `PUT` can be validated server-side (reject any array that isn't a permutation of exactly that key set — no unknown keys, no missing keys, no duplicates) rather than trusting the client's array blindly.

- `GET` returns the calling office-staff viewer's saved order (`req.practitioner.practitionerId` — the identity field every request already carries, regardless of role), or `null` if they've never customized — the frontend falls back to the default order shown in the reference screenshots.
- `PUT` upserts (`INSERT ... ON CONFLICT (practitioner_id) DO UPDATE`) the validated array.

No separate DELETE/reset endpoint — "reset to default" is a frontend-only action (just stop sending a custom order) that calls `PUT` with the default key array, which keeps the API surface to exactly two routes.

## Frontend design

### Visual restyle (existing components, same props/data contracts)

Every restyled component keeps its existing props and data shape — this is a markup/Tailwind-class change, not a data-flow change, so no other part of `CompanyDashboard.jsx`'s `useEffect`/fetch logic needs to move.

- **`VerdictBanner`**: swap the current purple/blue gradient for a navy/charcoal gradient (`#1a2744` → `#0f1829`-range, matched from the screenshot by eye since exact hex isn't extractable from a live SPA). Move the "Cleared" stat from inline prose into a labeled horizontal bar on the right side of the banner (label above, thin rounded bar below, percentage at the bar's end), matching the screenshot's "Cleared 97%" treatment — still driven by the same `ap.totalClear`/`ap.totalOwed` values already computed.
- **`StatCard`**: icon badge shrinks and moves to a small circle in the card's top-right corner (currently top-left, large) — same four tone gradients already defined, just resized/repositioned.
- **`BillingFunnel`**: stage bars become thin (screenshot shows a slim track, not the current chunky gradient-filled bar), value right-aligned outside the bar rather than embedded inside it; color simplifies to a single teal fill per bar instead of each stage's distinct gradient, since the reference uses one consistent color for "progress" rather than stage-specific hues.
- **`EimsDonut`**: keep the existing SVG ring approach (already structurally close to the reference) but simplify the center label and confirm the three-color legend order matches (Matched/teal, Mismatch-pending/amber, Missing-unverified/red) — this component needs the least change.
- **`PractitionerAccuracyTable`**: add a discipline subtitle line under each practitioner's name (new data: already available via `practitionerAccuracy` if the backend join is extended to include `position_title`, or via a lookup against the already-fetched `practitionerTable` rows which join `practitioners`) and switch the existing wide `w-20` progress bar to match the thinner reference style.
- **`ActionQueue`** ("What needs you"): right-align the dollar amount per row (screenshot shows amount flush right) — currently this component doesn't show a dollar figure at all, so this requires `getDayOverview`'s `flaggedSessions` to also return each line's estimated $ amount (one extra `total_time * pay_rate` computation per flagged row, same formula used everywhere else).
- **`ReturnedLogsPanel`**: already closely matches the reference's colored-left-border-tag treatment — minor spacing/sizing alignment only.

### New: `ServicesBreakdown`

Segmented tab control (reuses the existing `TrajectoryTabs` visual pattern — `bg-slate-50 rounded-[10px] p-[3px]` pill group) switching between the four dimensions returned by `getServicesBreakdown`. Below the tabs: one horizontal stacked bar (each category a proportional colored segment, width = `count / total * 100%`) and a legend list underneath showing each category's color dot, label, and count — directly mirroring the screenshot's "Speech therapy 341 / Occupational therapy 262 / ..." layout. Data fetches once per month-change (all four dimensions come back in a single `getServicesBreakdown` call, so switching tabs client-side is instant with no refetch).

### New: `DocumentsFeed`

A simple list (same `bg-white rounded-2xl border` card shell as every other section), each row showing the document icon, document number + type label, practitioner name + session count as a subtitle, amount right-aligned, and a status chip (teal/amber/red pill) — matching the screenshot's "Invoices & SEVF forms" card. Fetched once (all-time recent feed, not month-scoped, consistent with how `BillingFunnel`/`ReturnedLogsPanel` already treat their data as an all-time operational view rather than a month-scoped one).

### New: Customize + drag-to-reorder

- `DASHBOARD_SECTION_KEYS` constant (frontend) lists every reorderable section in its default order: `['pipeline_and_queue', 'services', 'accuracy_table', 'eims_and_documents', 'returned_logs_and_trajectory']` — grouped at the same granularity as the current two-column row layout (e.g. `BillingFunnel` + `ActionQueue` move together as one draggable unit, matching how they're already paired in one `grid` row), not at the level of every individual card, since splitting the two-column rows apart would require redesigning the responsive grid itself — out of scope here.
- A `useDashboardLayout()` hook fetches the saved order on mount (`GET /api/dashboard/layout`), falling back to `DASHBOARD_SECTION_KEYS`'s default order when `null`.
- `CustomizeToggle`: a button in the header (next to `MonthYearPicker`) that flips an `isCustomizing` boolean. While true, each section wrapper renders with a visible drag handle (`GripVertical` icon, top-right of the card) and `draggable="true"`; native HTML5 drag-and-drop (`onDragStart`/`onDragOver`/`onDrop`) reorders the in-memory array, matching the lightweight-dependency pattern already used throughout this codebase (no new npm package — `recharts` is the only non-trivial frontend dependency this dashboard already added).
- On drop, the new order is both applied immediately (optimistic) and persisted via `PUT /api/dashboard/layout`; a failed save is swallowed with a console error and does not revert the local reorder, matching this app's existing light-touch error handling for non-critical dashboard writes (e.g. `catch(() => setDay(null))` elsewhere in this same file never surfaces a toast).
- Sections render via `DASHBOARD_SECTION_KEYS`-driven `.map()` over the current order array, each resolving to its existing JSX block — this is a rendering-order change only, not a change to any section's internal content or data-fetching.

## Testing

- **Backend**: unit tests for `getServicesBreakdown`'s four-dimension grouping and "top 6 + Other" collapsing (pure-ish aggregation logic, mockable `pool.query`); `getDocumentsFeed`'s batch-level tier roll-up ("worst wins" — one exception line among otherwise-cleared lines must still produce `mismatch` for the whole batch); `saveDashboardLayout`'s validation (rejects a non-permutation array — missing key, duplicate key, or unknown key — with 400).
- **Frontend**: no new test infrastructure exists for `CompanyDashboard.jsx` today (it has none currently) — this redesign doesn't introduce one either, consistent with how the original dashboard plan also didn't add frontend tests for this file. Verification is visual/manual per the plan's verification section below.

## Review Focus

- A tenant with zero `assessments.type`/`.location` values set (all null) for the selected month — `getServicesBreakdown` must not crash or show a bar with a single "undefined" segment; nulls should collapse into an explicit "Not specified" category rather than being silently dropped (dropping them would make the stacked bar's total not match the KPI "Sessions this month" count, a visible inconsistency a CEO would notice).
- A `billing_batches` row with zero assessment lines attached (a created-but-never-populated batch, if that's reachable) — `getDocumentsFeed` must not divide by zero or show `NaN` for session count/amount; it should show `0 sessions` / `$0.00` and a `pending` status, not crash the whole feed.
- `PUT /api/dashboard/layout` called by a login without `master_reports` permission (including a clinical practitioner's own login, which never has this permission) — must 403 via the same `dashboardGuard` every other `/api/dashboard/*` route already uses, not silently accept writes from an unauthorized caller.
- Dragging a section and dropping it in the exact same position it started in — must not fire an unnecessary `PUT` (no-op reorder), and must not leave the UI in a stuck "customizing" visual state.
- A first-time office-staff viewer who has never saved a layout (`GET /api/dashboard/layout` returns `null`) opening Customize mode for the first time — must show the correct default order immediately, not a loading flicker or an empty section list.
