# Overview Dashboard: Hours View, Practitioner Filter, Search — Design

## Context

The CEO/admin "Overview" tab (`frontend/src/components/CompanyDashboard.jsx`, backed by `backend/src/controllers/dashboardController.js`) currently shows every metric as a session count and always covers the whole company (no way to scope it to one practitioner). The user asked for three additions, confirmed via direct Q&A in this session:

1. **A sessions↔hours toggle** that applies to the whole Overview tab — any metric currently shown as a session count gets an hours-equivalent alongside it, and the toggle switches which one displays. Dollar amounts and percentages are untouched (they aren't session counts to begin with).
2. **A practitioner filter** that scopes the entire Overview tab (banner, stat tiles, funnel, EIMS donut, accuracy table, returned logs, services breakdown, documents feed) to one practitioner at a time, or "All" (the current, unfiltered behavior) — single-select, same mental model as the existing `MonthYearPicker`.
3. **A search field** on the Overview card area that filters by practitioner or patient name across the page's already-loaded lists (Returned & declined logs, Practitioner accuracy table) — a client-side text filter, not a new backend search endpoint.

This is additive to the existing dashboard (see the prior `2026-10-20-overview-dashboard-redesign-design.md` spec, which built the current card set) — no existing computation logic changes, no existing response field is removed or renamed.

## Goals

1. Every endpoint the Overview tab calls accepts an optional `?practitionerId=<id>` param; when present, every query underneath it is scoped to that one practitioner, exactly as if they were the only person in the company that month.
2. Every endpoint's session-count fields gain a companion hours field (e.g. `sessionsChecked` → also `hoursChecked`), computed as `SUM(total_time) / 60.0` over the same row set the count comes from. Existing fields are untouched — this is purely additive.
3. A new minimal endpoint lists practitioners for the filter dropdown, scoped to the same `dashboardGuard` access level as the rest of Overview (not gated behind a separate `staff_directory_view`/`practitioner_manage` permission, which may not match who currently has Overview access).
4. One control bar, directly under the existing month picker, holds: practitioner dropdown, sessions/hours toggle, search field. Changing the practitioner re-fetches the tab's data (same pattern the month picker already uses); the hours toggle is instant (no refetch, just which field each component reads); search filters already-loaded rows client-side.

## Non-goals

- No change to any existing computation's business logic (how `accuracyPct`, EIMS tiers, or `ap.totalOwed` etc. are derived) — this only adds a practitioner-scoped `WHERE` and a companion hours sum alongside what already exists.
- No multi-select practitioner filter — single practitioner or "All" only, per explicit user confirmation.
- No backend search endpoint — search is a client-side filter over rows the page has already fetched for the current month/practitioner scope, consistent with how `PractitionerAccuracyTable`'s column sort already works client-side.
- `GET /api/dashboard/year`, `/years`, and `/layout` are not touched — they back the separate Year/Trajectory view, which the user did not ask to filter or toggle.
- `GET /api/dashboard/documents` (Invoices & SEVF forms feed) gets the practitioner filter but no hours companion — a document is a file, not a countable unit with duration.
- No change to how `ap.totalPaid`/the owed-vs-paid percentage (added earlier this session) is computed — the practitioner filter narrows which rows feed it, nothing else.

## Architecture

```
backend/src/controllers/dashboardController.js
  ~ getMonthOverview       + practitionerId filter on every sub-query;
                             + ap.{totalOwedHours,totalClearHours,totalHeldHours,totalPaidHours};
                             + practitionerAccuracy rows get hoursChecked/notCleanHours;
                             + volumeVsPriorMonth gets hours alongside count
  ~ getPipelineOverview    + practitionerId filter; + hours alongside each funnel/EIMS-sample count
  ~ getDayOverview         + practitionerId filter; + hours alongside flaggedCount/exception counts
  ~ getReturnedLogs        + practitionerId filter; + hours per row; + totalHours at the list level
  ~ getServicesBreakdown   + practitionerId filter; + hours alongside each category-bucket count
  ~ getDocumentsFeed       + practitionerId filter only (no hours companion)
  + getDashboardPractitioners   GET /api/dashboard/practitioners -> [{id, name}], dashboardGuard-gated

frontend/src/components/CompanyDashboard.jsx
  + OverviewControlBar (practitioner dropdown, sessions/hours toggle, search input)
  ~ CompanyDashboard's month-fetch useEffect: + practitionerId to params and dependency array
  ~ VerdictBanner, StatCard tiles, ActionQueue, FunnelRows/BillingFunnel, EimsDonut,
    ServicesBreakdown, PractitionerAccuracyTable, ReturnedLogsPanel:
    each takes a `unit` prop ('sessions' | 'hours') and reads the hours-companion field when hours
  ~ PractitionerAccuracyTable, ReturnedLogsPanel: + client-side filter by `searchQuery` prop
```

All six touched endpoints already sit behind `dashboardGuard` (`protect, loadPermissions, requirePermission('master_reports')`) in `dashboardRoutes.js` — the new `getDashboardPractitioners` endpoint uses the same guard, so the filter's option list is visible to exactly who can already see the page it filters.

## Backend design

### Practitioner filter — shared pattern

Every touched query gets the same additive shape `monthScope` already establishes for the month filter:

```js
const practitionerScope = (req) => {
  const raw = req.query?.practitionerId;
  if (!raw) return null;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
};
```

Each query's `WHERE` clause gets one more conditional fragment, following the same param-array-building style `getMonthOverview` already uses for `startDate`/`endDate`:

```js
const practitionerId = practitionerScope(req);
// ...
if (practitionerId) { params.push(practitionerId); sql += ` AND a.practitioner_id = $${params.length}`; }
```

For queries that join `practitioners p` already (the AP query, the practitioner-accuracy source query, `getReturnedLogs`' new `practitioners` join from this session's dollar-amount change), the same `a.practitioner_id = $N` fragment applies directly — no new join needed.

`getDayOverview`'s `exceptionRows` query (line ~101) already joins `practitioners p` and selects `total_time`/`pay_rate` — the filter and hours fragment both apply directly. Its two bare `COUNT(*)` queries do **not** currently filter or join on `practitioner_id` at all:
- `todayRows` (line ~93, `sessionsLoggedToday`/`practitionersActiveToday`): add `AND practitioner_id = $N` directly (the column already lives on `assessments`, no join needed) when scoped; `practitionersActiveToday` becomes meaningless (always 0 or 1) when a single practitioner is selected, so the frontend should hide that stat or substitute something else in that state — call this out to the user during implementation rather than ship a nonsensical "1 practitioner active" tile.
- `exceptionCountRows` (line ~114, backs `flaggedCount`): needs `practitioner_id` added to its `SELECT`/`WHERE` the same way — it currently selects nothing but `COUNT(*)`, so this is a one-line addition, not a rewrite.

`getPipelineOverview` (lines 280-354) has the same mix:
- `statusRows` (line 283, backs `byStatus`/`exceptions`/the whole funnel): bare `COUNT(*) ... GROUP BY billing_status`, no `practitioner_id` and no `total_time` — both need adding to the `SELECT`/`GROUP BY`/`WHERE`.
- `paidRows` (line 312): no `practitioner_id` — needs `AND a.practitioner_id = $N` added (the query already aliases `assessments` as `a`).
- `billedSessions` (line 334): already selects `practitioner_id` and `total_time` — filter and hours fragment both apply directly, no changes needed to the `SELECT` list.
- `pendingCheckedSessions` (line 344): already selects `practitioner_id` but not `total_time` — same gap as `getMonthOverview`'s identical sibling query (see point 2 above), needs `total_time` added to its `SELECT` list.

### Hours companion fields — shared pattern

Wherever a query already does `COUNT(*)` grouped or filtered by some dimension, and the underlying rows carry `total_time` (minutes), add a parallel `SUM(a.total_time) / 60.0 AS hours` to the same `SELECT`/`GROUP BY`, and expose it under a `hours<Thing>` key sibling to the existing `<thing>Count` key. Three concrete cases:

1. **`getMonthOverview`'s `ap` block** (lines ~608-643, already touched this session for `totalPaid`): the `apSessions.forEach` loop already computes `lineTotal` per session from `total_time`; add a parallel hours accumulator (`apTotalOwedHours`, etc.) using `hours = s.total_time / 60` in the same loop, no new query needed.
2. **`getMonthOverview`'s `practitionerAccuracy`** rows: the `billedSessions` query already selects `total_time` (line ~465); sum it per practitioner alongside the existing `sessionsChecked`/`notClean` counters, in the same in-memory reduction that currently builds those counters (`accuracyByPractitioner`, line ~502). The sibling `pendingCheckedSessions` query (line ~476, still-pending sessions already flagged by Compliance Analysis, also folded into this same accuracy scorecard) does **not** currently select `total_time` — add it to that query's `SELECT` list too, since its rows also contribute to `notClean`/`sessionsChecked` and must contribute to the hours companions for the two to stay consistent.
3. **`getReturnedLogs`**: already selects `total_time`/`pay_rate` this session (for the `amount` field); add `hours: Math.round((r.total_time / 60) * 100) / 100` per row, and `totalHours` as a top-level sibling to the existing `count`.

`getServicesBreakdown` (lines 979-1003) runs four bare `GROUP BY` queries (`typeRows`, `statusRows`, `locationRows`, `disciplineRows`) — none currently select `practitioner_id` or `total_time`; all four need both added to their `SELECT`/`WHERE`/`GROUP BY` (the `disciplineRows` query already joins `practitioners p`, so its `practitioner_id` fragment is `a.practitioner_id = $N` same as elsewhere; the other three reference `assessments` unaliased and need `AND practitioner_id = $N` directly). Add `SUM(total_time)/60.0 AS hours` to each query's `SELECT` list and expose it as a sibling field on each bucket object (e.g. `{ status: 'invoiced', count: 12, hours: 9.5 }`) via `bucketBreakdown` (the existing shared formatter all four rows pass through, line ~1008) — this helper (957-971) currently only carries `key`/`label`/`count` through and drops every other row field — it needs a small change to also carry `hours` (parsed the same way `count` is), including summing `hours` into the synthesized `{ key: 'other', ... }` bucket (line 969's `otherCount` reduction) the same way it already sums `count` for that bucket, not just the top-6 buckets.

### `getDashboardPractitioners(req, res)` — new, `GET /api/dashboard/practitioners`

```js
const getDashboardPractitioners = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name FROM practitioners
        WHERE role != 'independent_practitioner' ORDER BY first_name, last_name`
    );
    res.json({
      success: true,
      practitioners: rows.map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}`.trim() })),
    });
  } catch (error) {
    console.error('getDashboardPractitioners error:', error);
    res.status(500).json({ success: false, error: 'Failed to load practitioners' });
  }
};
```

Excludes `independent_practitioner` role, matching `practitionerAccuracy`'s existing exclusion of that role from the dashboard's cross-checked metrics (independent practitioners are self-reported, not EIMS-verified — see the accuracy table's existing subtitle copy). Registered in `dashboardRoutes.js`:

```js
router.get('/practitioners', ...dashboardGuard, getDashboardPractitioners);
```

## Frontend design

### `OverviewControlBar` — new component

Sits directly under the existing `MonthYearPicker` in `CompanyDashboard`'s render, before the `VerdictBanner`:

```
[ Month: October 2026 ▾ ]
[ Practitioner: All ▾ ]  [ Sessions | Hours ]  [ 🔍 Search practitioner or patient... ]
```

Props: `practitioners` (fetched once on mount via `GET /api/dashboard/practitioners`), `practitionerId`/`onPractitionerChange`, `unit`/`onUnitChange`, `searchQuery`/`onSearchChange`. A plain `<select>` styled to match `MonthYearPicker`'s existing control chrome for the practitioner dropdown (not a new design system); the sessions/hours toggle is a two-segment pill button (`Sessions` | `Hours`), matching this dashboard's existing `CustomizeToggle` button styling; search is a standard bordered text input with a leading search icon (reuse whatever icon set `lucide-react` already provides elsewhere in this file, e.g. the `Tag`/`Activity` icons already imported for `StatCard`).

### Data fetching — extend the existing effect

`CompanyDashboard`'s month-fetch `useEffect` (the one building `params = { month: monthValue }` and calling the six `load(...)` calls) gets `practitionerId` added to `params` when set, and added to the effect's dependency array:

```js
const params = { month: monthValue, ...(practitionerId ? { practitionerId } : {}) };
// ...
}, [monthValue, practitionerId]);
```

The existing `stale` guard (drops a response that arrives after the picker/filter has moved on) covers the practitioner filter for free — no new race-condition handling needed, since it's the same mechanism already protecting against rapid month changes.

### Unit toggle — prop threading, no refetch

A `unit` state (`'sessions' | 'hours'`, default `'sessions'`) lives in `CompanyDashboard` and is passed as a prop to every component that renders a session-count metric with an hours companion: `VerdictBanner`, the four `StatCard` tiles currently reading `month.volumeVsPriorMonth.current` etc., `ActionQueue`, `FunnelRows`/`BillingFunnel`, `EimsDonut`, `ServicesBreakdown`, `PractitionerAccuracyTable`, `ReturnedLogsPanel`. Each component picks `r.sessionsChecked` vs `r.hoursChecked` (etc.) via a tiny shared helper:

```js
const pick = (row, countKey, hoursKey, unit) => (unit === 'hours' ? row[hoursKey] : row[countKey]);
```

placed near this file's existing `money`/`compactMoney` helpers (top of file), and each affected component's existing label text gets a unit-aware suffix (`"sessions"` vs `"hrs"`) rather than a hardcoded string — e.g. `PractitionerAccuracyTable`'s "Checked"/"Not Clean" column headers and `ActionQueue`'s counts.

### Search — client-side filter

A `searchQuery` state in `CompanyDashboard`, debounced (reuse this file's existing debounce pattern if one exists, otherwise a plain 200ms `setTimeout` debounce local to `OverviewControlBar`), passed down to `PractitionerAccuracyTable` and `ReturnedLogsPanel` as a `searchQuery` prop. Each filters its already-fetched `rows`/`logs` array by a case-insensitive substring match against `name` (accuracy table) or `patientName`/`practitionerName` (returned logs) before rendering — the same spot `PractitionerAccuracyTable`'s existing `sorted = [...rows].sort(...)` already transforms its row list, so the filter composes with the existing sort rather than replacing it.

## Testing

Backend (Jest, following this file's existing `route()`/`useClient()` mock-by-regex pattern from `dashboardMonthScope.test.js` and this session's `dashboardApTotals.test.js`/`dashboardReturnedLogsAmount.test.js`):

- `getMonthOverview` with `practitionerId` set: the AP, accuracy, and volume sub-queries all receive the practitioner's id as a bound param; a different practitioner's sessions are excluded from every returned figure.
- `getMonthOverview` with no `practitionerId`: behavior is byte-identical to today (regression guard — this is the default/most-common case and must never change).
- `getMonthOverview`'s `ap` block: `totalOwedHours`/`totalClearHours`/`totalHeldHours`/`totalPaidHours` are each the correct `total_time`-derived sum for a small fixture of sessions with known minutes.
- `getReturnedLogs`: each row's `hours` is `total_time / 60` rounded to 2dp (mirroring the existing `amount` test); `totalHours` at the list level sums correctly across rows.
- `getPipelineOverview`/`getServicesBreakdown`: each bucket's `hours` sibling is the correct per-bucket `SUM(total_time)/60.0`.
- `getDashboardPractitioners`: excludes `independent_practitioner` role; returns `{id, name}` shape; empty company returns `{ success: true, practitioners: [] }` not an error.
- Every touched endpoint: a malformed/non-numeric `practitionerId` query param is ignored (treated as "All"), not a 400 or 500 — same defensive posture `monthScope` already has for a malformed `month` param.

Frontend (Vitest, following this project's existing component-test conventions):

- `OverviewControlBar`: changing the practitioner select calls `onPractitionerChange` with the selected id (or `null` for "All"); the sessions/hours toggle calls `onUnitChange` without triggering any network call; typing in search calls `onSearchChange` (debounced).
- `PractitionerAccuracyTable`: given a `searchQuery`, only rows whose `name` matches (case-insensitive substring) render; combined with an existing sort, both apply together.
- `ReturnedLogsPanel`: given a `searchQuery`, only rows whose `patientName` or `practitionerName` matches render; the panel's `totalAmount`/new hours-total line reflects only the filtered (not full) set — matching the principle that a filtered view's summary describes what's currently shown, not the unfiltered whole.
- A component given `unit="hours"` renders the hours-companion field and a `"hrs"`-suffixed label; given `unit="sessions"` (or omitted), behavior is byte-identical to today.

## Review Focus

- **`practitionerId` present but refers to a practitioner with zero sessions this month**: every card should render its existing "no data" empty state (e.g. `ReturnedLogsPanel`'s "No returned or declined logs this month. Nice.", `PractitionerAccuracyTable`'s "No agency practitioner sessions checked...") rather than an error or a blank card — these empty states already exist for the all-time-zero case and must also cover the filtered-to-zero case.
- **An independent practitioner selected via a stale/manipulated `practitionerId` query param**: `getDashboardPractitioners` excludes them from the dropdown's options, but the filter queries themselves must not error or silently include their self-reported (non-EIMS-verified) sessions if someone crafts the param directly — each filtered query should behave as if that id simply has no cross-checked data, consistent with how the accuracy table already excludes this role company-wide.
- **Hours shown for a session with `total_time = NULL` or 0** (a possible data state per existing schema, not validated away elsewhere in this file): the hours sum must treat it as 0 contribution, not `NaN` or a thrown error, mirroring the existing `s.total_time ? s.total_time / 60 : 0` guard already used in `getMonthOverview`'s AP loop.
- **Switching the unit toggle while a practitioner filter and search query are both active**: the toggle must not reset either the filter or the search text — they are three independent, orthogonal pieces of state, and a reasonable user toggling units mid-investigation expects their filter/search to persist.
- **Rapidly switching practitioners (or practitioner then back to "All") before the previous fetch resolves**: the existing `stale` flag guard must prevent an out-of-order response from a dropped practitioner selection from overwriting the current selection's data, the same protection already proven for rapid month changes.
