# EIMS Donut: "Billed with Unresolved Mismatch" Category — Design

## Context

The CEO/admin Overview dashboard's EIMS match status donut (`EimsDonut` in `frontend/src/components/CompanyDashboard.jsx`, backed by `getPipelineOverview` in `backend/src/controllers/dashboardController.js`) evaluates every billed session's EIMS compliance **live, right now** — against the current state of the EIMS reference data — not as a snapshot of what it looked like when the session was invoiced. This is a documented, intentional design dating back several commits (see the comment above `billedSessions`'s query: "a session billing set aside precisely because it DIDN'T clear EIMS is the whole reason this chart exists").

The user reported this as confusing: for September 2026, the dashboard showed 672 of 675 sessions as `invoiced` (billing already reviewed and cleared them), yet the EIMS donut's "Mismatch / pending" bucket showed 11 sessions. Investigated live against `tenant_izayaedge`'s September data: confirmed all 11 mismatched sessions are among the 672 already-`invoiced` ones (not among the 1 `rejected`/2 `declined`). Further investigation into `deriveEimsStatus`/`buildFieldsForSession` (`backend/src/utils/invoiceData.js`, `backend/src/controllers/billingController.js`) found that a session with an explicit human "Allow" (an acknowledged or learned field-mismatch override) is **already** counted as `matched` by this chart (labeled "Exception" internally, but bucketed as `matched`, not `flagged`) — so the 11 sessions in the `flagged`/"Mismatch" bucket, by construction, have **no override on file**. They were invoiced despite an unresolved EIMS discrepancy that nobody explicitly signed off on.

The user confirmed, via direct Q&A: this should become a new, distinct legend category — "sessions that are already billed (invoiced/completed) but currently show a live EIMS mismatch with nothing on file explaining why" — separate from the existing "Mismatch / pending" bucket (which going forward should only mean a mismatch on a session that has NOT yet been billed, i.e. is still actually blocking something). The user also asked, separately, to remove the existing "Unverified (no state file)" legend row entirely — those sessions should be dropped from the chart/total, not folded into another bucket.

## Goals

1. `getPipelineOverview`'s `eimsMatchRate` (and its `eimsMatchRateHours` companion, added in the prior Overview-hours-filter feature) gains a new key, `billedUnresolved`, for sessions that are already billed (any status other than `pending`/`on_hold`/`rejected`/`declined`) whose live EIMS evaluation is a genuine field mismatch (`tier === 'pending'`/label `'Mismatch'` per `deriveEimsStatus`) with no acknowledged or learned override on any field. The existing `flagged` key continues to mean "currently unresolved and NOT yet billed" — exactly the sessions that are actually still blocking payment today.
2. `unverified` is removed from `eimsMatchRate`/`eimsMatchRateHours` entirely — those sessions are excluded from the chart's total and percentage, not counted under any bucket.
3. A new endpoint, `GET /api/dashboard/billed-unresolved?month=YYYY-MM[&practitionerId=N]`, lists the specific sessions in the new `billedUnresolved` bucket (id, patient name, practitioner name, service date, billing status) for the drill-down.
4. `EimsDonut` gets a new legend row for this bucket, distinctly colored, clickable; clicking it opens an inline list (same visual pattern as `ActionQueue`'s row list) fetched from the new endpoint; clicking a row in that list opens the existing `SessionDetailDialog` (unchanged — already shows the full our-log-vs-EIMS-record field comparison for any `assessmentId`, which is exactly "what the mismatch is" for that session).
5. The "Unverified (no state file)" legend row is removed from `EimsDonut`.

## Non-goals

- No change to `deriveEimsStatus`'s tier/label logic itself, or to the acknowledgment/override mechanism (`acknowledged`, `learnedMatch`) — this only changes how `eimsBucket` routes an already-correctly-derived verdict into one more vs. fewer buckets.
- No change to `getMonthOverview`'s own separate `eimsMatchRate` (used by `practitionerAccuracy`, not rendered as this donut) — out of scope; that field's consumer doesn't render a donut with this exact bucket set, and the user's request is specifically about the Overview page's EIMS donut.
- No change to `getAccountsPayable`'s EIMS-tier logic (a separate consumer of `deriveEimsStatus`/`eimsBucket` for the all-time AP view) — same reasoning: distinct consumer, not the donut in question, not requested.
- No retroactive backfill or audit trail of *when* a session's live EIMS status first diverged from its state at invoice time — this reports the current live state only, same as the rest of this chart's existing design. A session could move in or out of `billedUnresolved` from one page load to the next if the underlying EIMS state data changes; that's consistent with how every other bucket already behaves.
- No new permission gate — the new endpoint uses the same `dashboardGuard` every other `/api/dashboard/*` route uses.

## Architecture

```
backend/src/controllers/dashboardController.js
  ~ eimsBucket(derived, humanHold, alreadyBilled)  -- new 3rd param
      + returns 'billedUnresolved' when alreadyBilled && bucket would be 'flagged'
        && no acknowledged/learned override exists for this session
      - 'unverified' branch removed (caller excludes these sessions instead)
  ~ getPipelineOverview  -- billedSessions.forEach: pass alreadyBilled + override flag;
      eimsMatchRate/eimsMatchRateHours gain billedUnresolved, drop unverified
  + getBilledUnresolvedSessions   GET /api/dashboard/billed-unresolved
      -> { success, sessions: [{id, patientName, practitionerName, serviceDate, status}] }

backend/src/utils/invoiceData.js
  ~ deriveEimsStatus  -- exposes whether an override/acknowledgment applied,
      so eimsBucket can tell "Mismatch, never addressed" apart from
      "Mismatch, human already said Allow" without re-deriving compliance

frontend/src/components/CompanyDashboard.jsx
  ~ EimsDonut  + new "Billed, unresolved mismatch" legend row (new color);
                - "Unverified (no state file)" row removed;
                + click opens an inline session list (new local component,
                  BilledUnresolvedList, styled like ActionQueue's rows)
                  fetched from the new endpoint
  ~ BilledUnresolvedList row click -> setSelectedSessionId (existing state,
      already wired to the existing SessionDetailDialog)
```

## Backend design

### `deriveEimsStatus` — expose the override flag

Currently (`invoiceData.js` lines 119-132), when `compliance.matched && !compliance.flagged`, the function computes `hadOverride` locally just to pick a label ("Exception" vs "Matched") and then discards it. `eimsBucket` needs this same signal for the **flagged** path (`compliance.matched && compliance.flagged`, line 133) to know whether an override exists even though the mismatch is NOT yet resolved to `matched` — i.e., "flagged" itself doesn't carry this, since an override only ever flips a field's `match` to `true`, so a session with ANY unacknowledged flagged field is `tier: 'pending'`/`label: 'Mismatch'` regardless of whether OTHER fields on it have overrides. The genuinely relevant question for `billedUnresolved` is simpler than that: **does this mismatched session have zero overrides anywhere on it** (truly nothing on file) or at least one (a human looked at something on this session, even if not everything)? Per the user's confirmed scope ("no exception was made" for the 11), only the zero-override case matters here.

Add a `hasOverride` boolean to the returned object wherever `compliance` is available, computed the same way as the existing local `hadOverride` (`(compliance.fields || []).some((f) => f.acknowledged || f.learnedMatch)`), moved to apply in both the cleared-with-override branch AND the still-flagged branch:

```js
if (compliance.matched && !compliance.flagged) {
  const hadOverride = (compliance.fields || []).some((f) => f.acknowledged || f.learnedMatch);
  return hadOverride
    ? { tier: 'cleared', label: 'Exception', hasOverride: true }
    : { tier: 'cleared', label: 'Matched', hasOverride: false };
}
if (compliance.matched && compliance.flagged) {
  const hasOverride = (compliance.fields || []).some((f) => f.acknowledged || f.learnedMatch);
  return { tier: 'pending', label: 'Mismatch', hasOverride };
}
```

Every other `return` in `deriveEimsStatus` gets `hasOverride: false` added for consistency (independent/missing/unverified/exception paths never have field-level overrides to check) — callers can rely on the key always being present rather than optional-chaining it.

### `eimsBucket` — new `billedUnresolved` routing, `unverified` removed

```js
const BILLED_STATUSES = ['invoiced', 'completed', 'self_certified'];
const eimsBucket = (derived, humanHold, alreadyBilled) => {
  if (humanHold) return 'flagged'; // a human hold/return/decline always wins, unchanged
  if (derived.tier === 'cleared') return 'matched';
  if (derived.label === 'Missing' || derived.label === 'Awaiting') return 'missing';
  if (derived.tier === 'unverified') return null; // caller excludes — no longer a counted bucket
  // Genuine unresolved mismatch (tier 'pending', label 'Mismatch' or 'Exception'-without-override
  // never reaches here since 'cleared' is already handled above): split by whether billing
  // already invoiced/completed it before it was ever resolved.
  if (alreadyBilled && !derived.hasOverride) return 'billedUnresolved';
  return 'flagged';
};
```

`alreadyBilled` is `BILLED_STATUSES.includes(s.billing_status)` — the three statuses that mean "billing has already acted on this" within the set `billedSessions`' own query already selects (`njeis_review`, `invoiced`, `completed`, `self_certified`, `on_hold`, `rejected`, `declined`); `on_hold`/`rejected`/`declined` are excluded from `BILLED_STATUSES` since those already route through the `humanHold` branch above and `njeis_review` is excluded since it means billing hasn't finished reviewing it yet (not yet actually billed).

A caller that receives `null` from `eimsBucket` (the unverified case) skips incrementing any bucket — `getPipelineOverview`'s `billedSessions.forEach` becomes:

```js
const bucket = eimsBucket(derived, humanHold, BILLED_STATUSES.includes(s.billing_status));
if (bucket) {
  eimsMatchRate[bucket] += 1;
  eimsMatchRateHours[bucket] += s.total_time ? s.total_time / 60 : 0;
}
```

`eimsMatchRate`/`eimsMatchRateHours` initial shape becomes `{ matched: 0, flagged: 0, missing: 0, billedUnresolved: 0 }` (both `getPipelineOverview` and anywhere else that initializes this shape for the donut specifically — `getMonthOverview`'s separate `eimsMatchRate` is explicitly out of scope per Non-goals and keeps its own existing shape unchanged). `pendingEimsBucket` (used for `pendingCheckedSessions`, which by definition are never billed yet) is unaffected — those sessions can never be `billedUnresolved` since they haven't been invoiced; its `unverified`-adjacent paths (there are none currently — `pendingEimsBucket` only returns `missing`/`flagged`/`matched`) need no change.

### `GET /api/dashboard/billed-unresolved` — new endpoint

```js
const getBilledUnresolvedSessions = async (req, res) => {
  try {
    const [monthStart, monthEnd] = monthScope(req);
    const practitionerId = practitionerScope(req);
    // Reuses the exact same billedSessions query/compliance-loading path as
    // getPipelineOverview so the list this returns can never disagree with
    // the donut's count — computed once per request, not cached/shared
    // across the two calls (acceptable: this endpoint is only hit on a
    // user's click, not on every page load).
    ...(same billedSessions query + loadComplianceBatched + roleById as getPipelineOverview)...
    const sessions = billedSessions
      .filter((s) => BILLED_STATUSES.includes(s.billing_status))
      .map((s) => ({ s, derived: deriveEimsStatus(s, { mode: ..., compliance: complianceById.get(s.id) }) }))
      .filter(({ derived }) => derived.label === 'Mismatch' && !derived.hasOverride)
      .map(({ s }) => ({
        id: s.id,
        patientName: ...decrypted patient name (needs an extra SELECT — billedSessions
          doesn't currently carry patient_first_name/last_name; add them to that query
          only when this endpoint needs them, or run a small follow-up SELECT by id list)...,
        practitionerName: ...,
        serviceDate: s.service_date,
        status: s.billing_status,
      }));
    res.json({ success: true, sessions });
  } catch (error) { ... }
};
```

Registered in `dashboardRoutes.js`: `router.get('/billed-unresolved', ...dashboardGuard, getBilledUnresolvedSessions);`

Patient/practitioner name decryption: `billedSessions`'s current `SELECT` (line 384) does not include `patient_first_name`/`patient_last_name`/`practitioner_first_name`/`practitioner_last_name`. Add them to that one query (both `getPipelineOverview` and this new endpoint read the same shape) rather than a second round-trip — this is the same set of columns `getReturnedLogs`/`getDayOverview` already select from `assessments`, decrypted with the same `decryptField` helper already imported in this file.

## Frontend design

### `EimsDonut` — new legend row, "Unverified" removed

The ring itself (the SVG arcs) is driven by `rate.matched`/`rate.flagged`/`rate.missing`/`rate.unverified` today; it becomes `rate.matched`/`rate.flagged`/`rate.missing`/`rate.billedUnresolved`, with a 4th arc color added to the existing teal/amber/rose set (the user's one explicit ask was to remove the gray "unverified" segment, which frees up a visual slot — reuse gray's old stroke position in the SVG draw order for the new segment, or pick a new color; violet (`#7c3aed`, already used elsewhere on this dashboard for `ServicesBreakdown`'s color palette) keeps it visually consistent with the rest of the page rather than introducing a new hue).

Legend:
```jsx
<div
  className="flex items-center justify-between text-[16px] cursor-pointer hover:bg-slate-50 rounded-lg -mx-2 px-2 py-1"
  onClick={() => setBilledUnresolvedOpen((v) => !v)}
>
  <div className="flex items-center gap-2 text-slate-700 font-semibold">
    <span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: '#7c3aed' }} />
    Billed, unresolved mismatch
  </div>
  <span className="font-mono font-extrabold text-[18px] text-slate-900">
    {displayRate.billedUnresolved.toLocaleString()}{unit === 'hours' ? ' hrs' : ''}
  </span>
</div>
{billedUnresolvedOpen && <BilledUnresolvedList month={monthValue} practitionerId={practitionerId} onSelectSession={onSelectSession} />}
```

`EimsDonut` needs a new prop, `onSelectSession` (threaded from `CompanyDashboard`'s existing `setSelectedSessionId`, same as `ActionQueue`/`ReturnedLogsPanel` already receive it) and `monthValue`/`practitionerId` (already available in `CompanyDashboard`'s scope) so the new list component can fetch independently of the main month-fetch effect — this list is fetched lazily, only on first expand, not preloaded with everything else (keeps the common case, where nobody clicks this row, free of an extra request).

### `BilledUnresolvedList` — new small component

Modeled directly on `ActionQueue`'s row list (same classes: `bg-slate-50 hover:bg-slate-100`, patient/practitioner name line, a date), fetched via `api.get('/api/dashboard/billed-unresolved', { params: { month: monthValue, ...(practitionerId ? { practitionerId } : {}) } })` in a `useEffect` keyed on `[monthValue, practitionerId]`, with its own loading/empty states (`"No billed sessions currently showing an unresolved mismatch."` when empty — this should be the common case, so reads as reassuring rather than alarming, same tone as `ReturnedLogsPanel`'s "Nice." empty state). Each row's `onClick` calls `onSelectSession(s.id)`, opening the page's existing shared `SessionDetailDialog`.

## Testing

Backend (Jest, same `route()`/`useClient()`/inline-mock conventions as this session's prior dashboard tests):

- `deriveEimsStatus`: a flagged field with no acknowledgment/learned-match returns `hasOverride: false`; a session with at least one acknowledged or learned-match field (even alongside other still-flagged fields) returns `hasOverride: true`; every non-mismatch return path (`matched`, `missing`, `unverified`, `exception`, `independent`) includes `hasOverride: false` for shape consistency.
- `eimsBucket`: `(derived={tier:'pending',label:'Mismatch',hasOverride:false}, humanHold=false, alreadyBilled=true)` → `'billedUnresolved'`; same inputs with `alreadyBilled=false` → `'flagged'`; same inputs with `hasOverride=true` → `'flagged'` (an override exists, even if not every field is clean, so this isn't the "nothing on file" case the user described); `(derived={tier:'unverified'}, ...)` → `null` regardless of other params; `humanHold=true` always wins regardless of the other two params (unchanged from today).
- `getPipelineOverview`: a fixture with one `invoiced` session whose `deriveEimsStatus` mock returns `{tier:'pending', label:'Mismatch', hasOverride:false}` produces `eimsMatchRate.billedUnresolved === 1` and `eimsMatchRate.flagged === 0`; a fixture with the same but `billing_status: 'njeis_review'` (not yet billed) produces `flagged === 1`, `billedUnresolved === 0`; a fixture with `hasOverride: true` on an `invoiced` session produces `flagged === 1` (not `billedUnresolved`); a fixture with `tier: 'unverified'` contributes to neither bucket and is absent from the response's `eimsMatchRate` keys' sum (confirms the chart's total shrinks, doesn't silently fold in).
- `getBilledUnresolvedSessions`: returns only sessions matching the `billedUnresolved` criteria (mirrors the `getPipelineOverview` fixture above); `?practitionerId=` filters correctly; decrypted patient/practitioner names match the pattern `getReturnedLogs` already tests; an empty result returns `{ success: true, sessions: [] }`, not an error.

Frontend (Vitest):

- `EimsDonut`: clicking the new legend row toggles `BilledUnresolvedList`'s visibility without affecting the ring/other legend rows; the "Unverified (no state file)" row is absent from the rendered legend entirely; `unit="hours"` shows the row's hours-companion value with an "hrs" suffix.
- `BilledUnresolvedList`: renders a row per session from the mocked endpoint response; clicking a row calls `onSelectSession` with that session's id; the empty-state message renders when the list is empty; a fetch failure doesn't crash the donut (graceful empty/error state, consistent with how other list fetches on this page already degrade).

## Review Focus

- **A session with an override on SOME fields but a different field still genuinely unresolved, on an already-invoiced session**: per the user's confirmed scope, this is NOT `billedUnresolved` (it has *an* override on file, even if incomplete) — it stays `flagged`. Worth flagging explicitly since "has an override on file" and "is fully resolved" are different claims, and a reader could reasonably expect `billedUnresolved` to mean "fully nothing addressed" vs. this looser "zero acknowledgments of any kind" test — the spec's `hasOverride` check is deliberately the coarser, simpler signal the user asked for, not a per-field breakdown.
- **A `self_certified` (independent-practitioner) session landing in `billedUnresolved`**: independent-practitioner sessions never reach `deriveEimsStatus`'s compliance-comparison branches at all (`mode === 'independent'` short-circuits earlier in the function, `invoiceData.js` lines 103-107) — they can only resolve to `cleared`/`Self-rep.` or `pending`/`Not entered`, never `label: 'Mismatch'`, so they structurally cannot reach `billedUnresolved`. No special-casing needed, but worth a test asserting this rather than assuming it.
- **The donut's percentage/ring math after `unverified` is dropped and `billedUnresolved` is added**: `total = matched + flagged + missing + billedUnresolved` (not `+ unverified`, which no longer exists) — confirm `EimsDonut`'s existing `total`/`empty`/`matchedPct` calculation is updated to the new key set, not left silently summing a now-undefined `rate.unverified`.
- **The new `GET /billed-unresolved` endpoint re-running compliance analysis independently of `getPipelineOverview`**: since both run `loadComplianceBatched`/`computeSessionCompliance` fresh per request rather than sharing a cache, a session could theoretically appear in the donut's count on page load but then NOT appear in the drill-down list (or vice versa) if the underlying EIMS state data changes in the seconds between the two requests. This is an accepted, documented limitation (same "live reconciliation" tradeoff already inherent to this whole chart), not a bug to fix here — flagged so it isn't rediscovered and treated as a regression later.
- **Empty "Billed, unresolved mismatch" is the expected, good state**: the empty-state copy must read as reassuring ("No billed sessions currently showing an unresolved mismatch") rather than alarming, since a CEO clicking this row and finding zero results is the healthy outcome, not a missing-feature signal.
