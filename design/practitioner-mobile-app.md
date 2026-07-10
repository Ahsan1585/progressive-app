# Design: Practitioner Mobile App (`mobile/`)

Source spec: `specs/practitioner-mobile-app.md`. This document is structural only —
no color, type, or motion decisions. Those belong to the Design Director
(stage 3). All navigation described below assumes a dedicated mobile app
shell (bottom tab bar as primary navigation), not a responsive squeeze of the
desktop sidebar layout.

## App shell decision

Primary navigation is a **bottom tab bar with 4 destinations**, reachable
one-handed:

1. **Home** — quick stats overview (story 8)
2. **Roster** — patient list, search, add (story 4)
3. **Inbox** — rejected/declined logs, with a badge showing the un-acknowledged
   count (story 7)
4. **Profile** — account actions: voluntary password change, saved-signature
   management, log out

"Log Intervention" is **not** a tab. It only makes sense in the context of a
specific patient, so it is always entered from that patient's Detail screen
(story 6), matching the spec's phrasing ("opens Log Intervention for a
selected patient"). The pre-auth stack (Login / Forced Password Change /
Forgot / Reset Password) renders with **no tab bar at all**.

---

## User flows

### Flow 1 — First login, forced password change (stories 1, 2)
1. Practitioner opens the app to the Login screen (entry point: app launch
   while logged out).
2. Enters email + password, submits.
3. `POST /api/auth/login` succeeds; response includes `requirePasswordChange: true`.
4. App stores the JWT and immediately routes to Forced Password Change —
   **the tab bar is not rendered**, and there is no way to reach Roster,
   Inbox, Home, or Profile until this screen is completed.
5. Practitioner enters a new password meeting the strength rule; live
   checklist reflects each rule as it's satisfied.
6. Submits; `POST /api/auth/change-password` succeeds; flag clears.
7. App routes to Home (end state: authenticated, tab bar now present).

### Flow 2 — Returning login (story 1)
1. Login screen, entry point: app launch while logged out, or after idle
   auto-logout.
2. Valid credentials + `role = practitioner`, `requirePasswordChange` false →
   straight to Home.
3. Invalid credentials → generic "Invalid credentials" error, stays on
   Login (end state).
4. Deactivated account → "account deactivated, contact your administrator"
   error, no token stored, stays on Login (end state).

### Flow 3 — Unsupported role blocked (story 1, acceptance criterion 4)
1. Any role other than `practitioner` authenticates successfully at the API
   level.
2. App recognizes the role is unsupported and routes to a dead-end
   "Unsupported role" screen — never attempts to render Home/Roster/etc.
3. Only action available: "Back to login," which discards any token/role
   the app may have cached and returns to Login (end state).

### Flow 4 — Forgot / reset password (story 3)
1. From Login, practitioner taps "Forgot password?" → Forgot Password screen.
2. Enters email, submits. `POST /api/auth/forgot-password` always returns
   the same generic success message; app shows it verbatim regardless of
   whether the email exists (end state for this sub-flow: back-to-Login
   affordance shown).
3. Practitioner receives email, either (a) taps the deep link, which opens
   the app directly to Reset Password with the token pre-attached, or
   (b) copies the token and pastes it manually into a token field on Reset
   Password (both paths must exist — deep linking cannot be assumed
   reliable on every device/OS configuration).
4. If token valid and within 30 minutes: practitioner enters a new
   valid-strength password, submits, `POST /api/auth/reset-password`
   succeeds → success confirmation → routed to Login pre-filled with a
   "password updated, log in" banner (end state).
5. If token expired/invalid: "this reset link is invalid or expired" shown
   with a "Request a new reset link" action that returns to step 1 (Forgot
   Password screen).

### Flow 5 — Add a new patient (story 4)
1. From Roster, practitioner taps "Add Patient."
2. Fills first/last name, DOB, county, Child ID.
3. Child ID is validated client-side as exactly 9 digits as the practitioner
   types/leaves the field — no round trip needed to reject a bad length.
4. Submits a valid form → `POST /api/patients/register` succeeds → new
   patient appears in the roster list → app auto-lands the practitioner on
   that new patient's Detail screen (end state), since adding a patient in
   the field is almost always immediately followed by logging a visit.
5. Server-side rejection (e.g., duplicate Child ID) → inline banner with the
   API's message, form retains entered values, practitioner can correct and
   resubmit.

### Flow 6 — Search/filter roster and select a patient (story 4)
1. Roster screen loads the practitioner's full patient list
   (already-fetched, client-side filtering).
2. Practitioner types into the search field (or applies a filter); the
   visible list narrows by name and/or Child ID as they type, no additional
   requests fired.
3. Practitioner taps a row → navigates to that patient's Detail screen
   (server-enforced ownership; not reachable for another practitioner's
   patient through normal navigation) (end state).

### Flow 7 — View patient detail and encounter history (story 5)
1. Entry points: tap a roster row, or auto-land after adding a patient.
2. Detail screen fetches `GET /api/patients/:id/assessments`.
3. Zero prior encounters → explicit empty state, not a blank list, with a
   prompt toward the primary "Log Intervention" action.
4. One or more encounters → most-recent-first list of visit summaries (end
   state: practitioner has context before logging a new visit or reviewing
   a past one).
5. Edge case: if the assessments call ever returns 403 (should not be
   reachable via normal navigation, but must not crash) → generic error
   state with Retry and "Back to Roster" (no ownership details leaked).

### Flow 8 — Log a new intervention (story 6)
1. From a patient's Detail screen, practitioner taps "Log Intervention"
   (sticky, always-reachable primary action).
2. Full-screen flow opens, pre-fetching the practitioner's saved default
   signature (`GET /api/practitioner/profile`) in the background.
3. Practitioner fills date (defaults to today), start time, end time — total
   time auto-computes and displays immediately, no manual entry.
4. Selects service type, status, and location from the fixed NJEIS
   vocabularies (19/5/8 options respectively) — no free text, no invented
   codes.
5. Parent/caregiver signature: drawn fresh on a touch-sized canvas (no saved
   option for this signer).
6. Practitioner signature: if a saved default exists, "Use my saved
   signature" is offered as the lead option; practitioner may instead draw a
   fresh one. If they draw fresh, they can opt to save it as their new
   default (`POST /api/practitioner/signature` fires on submit if opted
   in).
7. Practitioner taps "Save Encounter." If any required field or either
   signature is missing, submission is blocked and the app scrolls to/
   focuses the first missing field with an inline message — nothing is
   silently dropped.
8. On success, `POST /api/interventions` completes; toast confirms; app
   returns to Patient Detail with the new log at the top of the history
   (end state).
9. On failure, the form is preserved as-is (no data loss) with a banner
   error; practitioner can retry.
10. If the practitioner backs out mid-form with unsaved data (any field
    touched or a signature captured), a confirm-discard prompt appears
    before leaving.

### Flow 9 — Resolve a returned (rejected) log (story 7)
1. Entry point: Inbox tab, or a "logs need your attention" prompt on Home.
2. Practitioner opens a log with `billing_status = rejected` ("Returned").
3. Billing note and rejection date shown prominently above the edit form.
4. Practitioner edits type, location, start/end time (total recomputes
   live), status.
5. Submits → `POST /api/patients/resubmit-log` with the assessment ID and
   revised fields → log moves to `pending`, disappears from Inbox (end
   state).
6. Edge case: API rejects because the log is no longer in `rejected` state
   (e.g., an admin acted on it concurrently) → app shows the API's error,
   does **not** assume success, and refreshes the Inbox list so the stale
   row is removed/updated.

### Flow 10 — Resolve a declined log (story 7)
1. Practitioner opens a log with `billing_status = declined` (terminal).
2. Only action offered is "Acknowledge," presented as a lightweight sheet
   (not a full edit form) with the billing note shown and an optional
   free-text response field.
3. Submits → `POST /api/patients/acknowledge-log` with assessment ID and
   optional `response` → removed from Inbox (end state).
4. Same concurrent-action edge case as Flow 9: API error shown, Inbox
   refreshed rather than assuming success.

### Flow 11 — Quick stats glance (story 8)
1. Entry point: Home tab (also the landing screen right after login/forced
   password change).
2. While `GET /api/patients/practitioner-stats` is in flight, stat tiles
   show a loading state — never a flash of "0."
3. On success, three values render: logs this month, hours this month
   (minutes summed, converted), logs still in the pipeline (`pending` +
   `njeis_review`) (end state).
4. On failure, Home still renders (it's the landing screen) but the stats
   block shows its own inline error/retry rather than blocking the whole
   screen.

### Flow 12 — Idle auto-logout (story 9)
1. Practitioner is authenticated, app in foreground, no touch/scroll/
   keyboard/tap interaction.
2. At 13 minutes idle, a warning overlay appears (global, over whatever
   screen is active): "You'll be logged out in 2 minutes due to inactivity"
   with a live countdown and a "Stay logged in" button. See Open Questions
   for why this warning was added versus the web app's silent timeout.
3. If the practitioner explicitly taps "Stay logged in" (a deliberate action,
   not just ambient touch, since the warning appearing means normal
   interaction already stopped), the idle timer resets and the warning
   dismisses.
4. If any other real interaction occurs (tap/scroll/type outside the
   warning) the timer also resets per the existing web behavior.
5. If 15 minutes elapse with no interaction, token is discarded and the app
   routes to Login with a disclosure banner: "You were logged out after 15
   minutes of inactivity to protect patient information" (end state).
6. Backgrounding: app records a last-active timestamp on backgrounding. On
   foreground resume, elapsed background time counts toward the 15 minutes.
   If resuming past the 15-minute mark, the app skips straight to the
   logged-out Login state with the same disclosure banner (the practitioner
   wasn't present to see a warning). If resuming inside the 13–15 minute
   window, the warning overlay shows immediately on resume.

---

## Screens / components

### Pre-auth stack (no tab bar)

**Login**
- Purpose: authenticate a practitioner.
- Fields: email, password, "Forgot password?" link, submit.
- States: default; loading (submit disabled, spinner); error — invalid
  credentials (generic); error — deactivated account (specific message);
  error — unsupported role (routes to Unsupported Role screen rather than
  rendering inline); success (routes onward per Flow 1/2).

**Unsupported Role**
- Purpose: dead-end for any non-practitioner role.
- Content: explanation message, "Back to login" action (clears any cached
  token/role).
- States: static (single state).

**Forced Password Change**
- Purpose: block all other navigation until a first-login password change
  is complete.
- Fields: new password, confirm, live strength checklist.
- States: default; client-side rule violation (inline, same rule text as
  API); submitting; server-side error (verbatim API text); success (routes
  to Home). No tab bar, no back navigation (hardware back / swipe-back must
  be intercepted or disabled) — this screen must not be escapable.

**Forgot Password**
- Purpose: request a reset email.
- Fields: email, submit.
- States: default; submitting; success (generic message, always shown);
  network/server error (retry).

**Reset Password**
- Purpose: complete a password reset from an emailed link or pasted token.
- Fields: token (hidden/pre-filled + "verifying…" state if opened via deep
  link; visible/editable if opened manually), new password, confirm,
  strength checklist.
- States: verifying token (loading); token expired/invalid ("this reset
  link is invalid or expired" + "Request a new reset link" CTA back to
  Forgot Password); valid-strength submission in flight; server error;
  success (routes to Login with confirmation banner).

### Authenticated app shell (bottom tab bar)

**Home (Stats Overview)** — tab 1, and the landing screen post-login
- Purpose: quick-glance productivity snapshot (story 8) and a jumping-off
  point toward action needed elsewhere.
- Content blocks: greeting header, 3 stat tiles (logs this month, hours
  this month, logs in pipeline), a "logs need your attention" prompt when
  the Inbox has un-acknowledged items (secondary but visible — this is the
  most consequential unread state in the app and shouldn't be buried a tab
  away).
- States: loading (skeleton tiles, structurally distinct from a "0" value
  so a legitimate zero-logs month is never confused with "still loading");
  loaded; stats-fetch error (inline retry within the tile area, doesn't
  block the rest of Home).

**Roster** — tab 2
- Purpose: find or create the right patient (story 4).
- Content blocks: search/filter field (top, always visible), "Add Patient"
  action (header icon button, not a tab), scrollable patient list.
- States: loading (skeleton rows); empty roster ("No patients yet — add your
  first patient" with the Add action promoted/centered, since the empty
  case has a single obvious next step); search/filter yields no rows
  (distinct copy: "No patients match '{query}'" + clear-search action,
  never confused with the true empty-roster state); populated; fetch error
  (retry banner).

**Add Patient** (pushed full screen from Roster, not a small modal — the
field count and on-screen keyboard need the space)
- Fields: first name, last name, DOB, county, Child ID.
- States: default; inline field errors (Child ID length is validated as the
  practitioner types/blurs, before any submit attempt); submitting; server
  error (banner, values retained); success (routes to the new patient's
  Detail screen).

**Patient Detail / Encounter History** (pushed from Roster row tap or from
Add Patient success)
- Content blocks: patient header (name, Child ID, DOB, county), sticky
  "Log Intervention" primary action (always reachable without scrolling),
  encounter history list (most-recent-first).
- Each history row: date, service type, status, location, billing status
  (as a text-labeled badge, not color-only), total time.
- States: loading (skeleton); empty history ("No visits logged yet for
  {name}" pointing at the Log Intervention action); populated; error
  (including the 403/not-owner edge case) — generic "Something went wrong
  loading this patient" + Retry + Back to Roster, no ownership detail
  leaked, no crash.

**Log Intervention** (pushed full screen from Patient Detail)
- Structural decision: a **single continuous scroll**, not a rigid
  multi-step wizard. Standing in a living room, a practitioner benefits
  from being able to see and jump between sections rather than stepping
  forward/back — but a sticky top section-chip bar (Details / Codes /
  Signatures) lets them jump straight to Signatures if the codes are
  already filled. A sticky bottom bar holds the Submit action and shows a
  live count of what's still missing so submit-readiness is never a
  surprise.
- Section A — Visit details: date, start time, end time, auto-computed
  total time (read-only, updates live as either time field changes).
- Section B — Service codes: service type (19 options), status (5
  options), location (8 options) — fixed vocabularies only, rendered as
  touch-sized pickers, not dense desktop `<select>` elements.
- Section C — Signatures: two Signature Capture instances (see shared
  component below) — parent/caregiver (always drawn fresh) and
  practitioner (saved-default reuse offered first if one exists, drawing
  fresh always available, "save as new default" opt-in on a fresh draw).
- States: default/empty; field-level validation (each missing/invalid
  required field flagged inline, plus a running summary near the sticky
  submit button); submitting (submit disabled, spinner, no double-submit);
  server error (form data preserved, banner shown, retry available);
  success (toast + return to Patient Detail with new log at top); discard
  confirmation if leaving mid-form with any data entered.

**Rejected/Returned Inbox** — tab 3
- Purpose: single place to resolve billing feedback (story 7).
- Content blocks: list of un-acknowledged logs with `billing_status`
  `rejected` or `declined`, each row showing patient, date, a clearly
  distinct "Returned" vs. "Declined" label (not color-only — the actions
  differ), billing note preview, rejection date.
- States: loading (skeleton); empty ("You're all caught up — no rejected or
  declined logs," a deliberately positive empty state since an empty inbox
  is good news here); populated; fetch error (retry). Tab icon carries a
  count badge.

**Resubmit Log** (pushed from an Inbox row where `billing_status = rejected`)
- Content blocks: billing note + rejection date shown above the form
  (that's the reason the practitioner is here, so it leads); editable
  fields pre-filled with existing values: type, location, start/end time
  (total recomputes live), status. Signatures are **not** re-collected here
  — the resubmit payload only carries the assessment ID and revised fields.
- States: default (pre-filled); validation errors; submitting; server error
  incl. the race-condition case (log no longer `rejected`) — shows the
  API's error and refreshes the Inbox rather than assuming success; success
  (toast + back to Inbox, row removed).

**Acknowledge Decline** (bottom sheet, opened from an Inbox row where
`billing_status = declined` — deliberately lighter-weight than Resubmit
since it is a single action with one optional field, not a multi-field
edit)
- Content: billing note (why declined), read-only log summary, optional
  free-text response note, "Acknowledge" primary action. No edit fields.
- States: default; submitting; server error incl. the same race-condition
  case as Resubmit; success (toast + back to Inbox, row removed).

**Profile** — tab 4
- Purpose: account-level actions that aren't tied to a specific patient —
  most importantly, a reachable log-out affordance, plus voluntary (not
  forced) password change and saved-signature management for parity with
  the web app's capabilities. See Open Questions — the spec doesn't
  explicitly request the latter two, but the app needs *some* home for
  logout and there is no other natural place for the profile-level API
  calls the mobile app already needs (`GET/POST /api/practitioner/profile`,
  `/api/practitioner/signature`).
- Content blocks: practitioner name/email header; "Change password" row
  (reuses the password-change form, but cancelable, unlike the forced
  variant); "My saved signature" row (thumbnail of current default +
  "Update," reusing the Signature Capture component standalone); "Log out"
  action (confirm dialog, since it clears the token immediately).
- States: loading (profile fetch); populated; error (retry); each sub-flow
  (change password, update signature) has its own default/submitting/
  error/success states matching the patterns above.

**Idle Warning** (global overlay, can appear over any authenticated screen)
- States: hidden (default); visible with live countdown; dismissed via
  explicit "Stay logged in" tap or genuine interaction elsewhere.

**Session Expired / Logged Out** (transition, not a distinct destination —
lands back on Login)
- State: Login screen with a disclosure banner explaining the idle logout,
  shown once, dismissible.

### Shared components (used across 2+ screens)

- **Signature Capture canvas** — touch/stylus drawing surface + Clear +
  (practitioner slot only) "Use saved signature" toggle-back control.
  States: empty/unsigned, actively drawing, captured (preview + redo path),
  cleared. See Accessibility notes for interaction-specific handling.
- **Status Badge** — billing_status indicator (`pending`, `njeis_review`,
  `rejected`/"Returned", `declined`, `invoiced`), always paired text label +
  icon, never color-only.
- **Empty State** — icon slot, heading, subtext, optional primary CTA;
  reused (with different copy) on Roster, Patient Detail history, and
  Inbox.
- **Loading Skeleton** — reused for Home stat tiles, Roster rows, Patient
  Detail history rows, Inbox rows.
- **Inline Error Banner + Retry** — reused anywhere a fetch can fail
  without blocking the whole screen.
- **Toast/Confirmation** — success acknowledgments (encounter saved, log
  resubmitted, log acknowledged, password changed, signature updated).
- **Confirm Dialog** — discard-unsaved-changes (Log Intervention),
  log-out confirmation.
- **Bottom Sheet** — Acknowledge Decline; reusable for any other
  lightweight single-action flow later.

---

## Information architecture

```
Pre-auth stack (no tab bar)
  Login
    ├─ Forgot Password ──(email sent)──> back to Login
    ├─ Reset Password (deep link or manual token) ──success──> Login (confirmation banner)
    └─ (unsupported role) ──> Unsupported Role ──"Back to login"──> Login

Auth gate (evaluated right after login success)
  requirePasswordChange = true  → Forced Password Change (locked, no tab bar) → success → Home
  requirePasswordChange = false → Home

Authenticated shell (bottom tab bar: Home | Roster | Inbox | Profile)
  Home
    └─ "attention" prompt → Inbox (tab switch)
  Roster
    ├─ search/filter (in place, no navigation)
    ├─ Add Patient (push) → success → Patient Detail (new patient)
    └─ patient row (tap) → Patient Detail
         └─ Log Intervention (push, full screen) → success → back to Patient Detail (new log at top)
  Inbox
    └─ row (tap)
         ├─ billing_status = rejected  → Resubmit Log (push) → success → back to Inbox
         └─ billing_status = declined  → Acknowledge Decline (sheet) → success → back to Inbox
  Profile
    ├─ Change Password (push, cancelable) → success → back to Profile
    ├─ Manage Saved Signature (push) → success → back to Profile
    └─ Log Out (confirm) → clears token → Login

Global overlays (can appear over any authenticated screen)
  Idle Warning → "Stay logged in" dismisses, OR timeout → Session Expired → Login
```

Ownership/scoping: every patient-scoped screen (Detail, Log Intervention,
Resubmit, Acknowledge) is only reachable through the Roster or Inbox lists
that the API already scopes to the authenticated practitioner
(`practitioner_id`); there is no direct-URL/deep-link entry point into
another practitioner's patient in this app.

---

## Accessibility notes

General (WCAG 2.1 AA):
- All touch targets ≥ 44×44px, including the small "Clear" controls on the
  signature canvas and row-level action icons.
- Never convey state (billing status, validation pass/fail, saved-default
  vs. drawn signature) by color alone — pair every color cue with a text
  label or icon, per the Status Badge component above.
- Body/label text meets 4.5:1 contrast; this is a structural requirement to
  hand to the Design Director, not a color choice made here.
- Support platform text-scaling/zoom without horizontal scroll or clipped
  controls — single-column layouts throughout support this by default.
- Form fields always have a persistent visible label (not placeholder-only
  text), and correct `autocomplete`/input-purpose hints (`email`,
  `new-password`, numeric keypad for Child ID and time fields).

Keyboard / focus (relevant if the eventual build is a PWA reachable by
external keyboard, switch control, or assistive tech — and regardless of
platform, screen-reader focus order still applies):
- Focus order matches visual order on every screen; e.g. Login: email →
  password → "Forgot password?" → submit. Log Intervention: date → start
  time → end time → (auto-computed total is not focusable, but changes are
  announced via an `aria-live="polite"` region) → service type → status →
  location → parent-signature controls → practitioner-signature controls →
  "save as default" toggle → submit.
- Modals/sheets/dialogs (Idle Warning, Confirm Dialog, Acknowledge Decline
  bottom sheet) trap focus while open, restore focus to the triggering
  element on close, and are labeled via `aria-modal="true"` +
  `aria-labelledby` pointing at their heading.
- The Forced Password Change screen intentionally has no reachable "back":
  this must not create a keyboard trap in the accessibility sense — there
  is simply no other screen to tab into, which is a legitimate, disclosed
  restriction (not a bug), but it should be stated as such in-product
  ("You must set a new password to continue").

ARIA / semantic roles:
- Roster list, encounter history, and Inbox use list/listitem semantics
  (or the platform-native list equivalent) so assistive tech announces
  item count and position.
- Inline validation errors use `role="alert"` (or the platform-native
  equivalent) and are associated with their field via
  `aria-describedby`, matching the acceptance criteria's "field-level
  indication of what's missing."
- Toasts/confirmations use a polite live region so they're announced
  without interrupting whatever the practitioner is doing.
- The Idle Warning's countdown updates are announced via a live region
  (assertive, since it's time-sensitive) so a screen-reader user isn't
  silently logged out.

Signature capture — specific mobile interaction handling:
- The canvas must call `preventDefault()`/set `touch-action: none` on
  drawing gestures so the surrounding screen does not scroll while the
  practitioner or parent is signing — a common mobile bug if untreated.
- Canvas sized to the full available width and to a height materially
  larger than the current desktop implementation's 120px, since a finger
  or stylus stroke needs more room than a mouse cursor did.
- "Clear" and "Use saved signature" controls must sit outside the drawing
  surface's hit area so a stray touch mid-signature can't trigger them.
- Once a stroke sequence ends, show an explicit "captured" confirmation
  state (not just a static drawn line) with an obvious way to redo —
  don't rely on the practitioner inferring capture succeeded.
- Provide an accessible name/instruction for the canvas itself (e.g.,
  "Practitioner signature — draw with your finger or stylus") since a
  freeform canvas has no inherent semantics.
- Known, unresolved limitation: a canvas-only signature has no accessible
  path for a practitioner who cannot perform a drawing gesture (e.g., a
  motor-impairment/switch-control user). This mirrors the existing web
  app's limitation and isn't something this stage can fix without a new
  API-level alternative (e.g., a typed-name affidavit field) — flagged
  below in Open Questions rather than resolved unilaterally here.

Idle-logout UX — explicit decision:
- The existing web app logs out silently and immediately at 15 minutes
  with no warning (`IdleLogout` in `frontend/src/App.jsx`). For this
  mobile app, a **warning state is added** (13-minute mark, 2-minute
  countdown, explicit "Stay logged in" action) rather than reproducing the
  silent behavior. Rationale: (a) WCAG 2.1 SC 2.2.1 (Timing Adjustable)
  expects a way to extend a session-ending time limit unless a listed
  exception applies, and a silent security-driven logout is a common but
  not automatic exception; (b) on mobile, silently losing an in-progress,
  un-autosaved Log Intervention form (signatures included) is a materially
  worse failure mode than on desktop, given no offline/draft-save is in
  scope. This is a deliberate deviation from web-app parity, not an
  oversight — flagged for confirmation in Open Questions.

---

## Open questions

1. **Idle-warning deviation from web parity.** This design adds a 2-minute
   warning before the 15-minute idle logout (web app has none). Confirm
   this is acceptable given the spec says "mirroring the existing web
   app's `IdleLogout` behavior" for the *timeout mechanics* — the warning
   is additive UX, not a change to the 15-minute threshold itself, but it
   should be explicitly signed off rather than assumed.
2. **Signature capture has no accessible alternative** for practitioners
   who cannot perform a drawing gesture. This mirrors the current web app
   and is outside this stage's authority to fix (would need a new
   API-level alternative such as a typed-name affidavit), but should be
   raised with product/legal given ADA/WCAG exposure either way.
3. **Log Intervention layout choice** (single continuous scroll with
   section chips vs. a strict multi-step wizard) was decided here in favor
   of the former for field-use resilience. Flag if the next stage or
   stakeholders have a strong preference for a stricter step-by-step
   wizard instead.
4. **Practitioner-signature default hierarchy** was inverted from the
   current web app (which defaults to drawing and offers "insert master
   signature" as a secondary action) to defaulting toward "use my saved
   signature" first when one exists, since drawing on a small screen is
   higher-friction than on desktop. Confirm this is the desired priority.
5. **Profile tab's scope** (voluntary password change, saved-signature
   management) is not explicitly requested by any user story — it was
   added because the app needs a home for logout and for the two
   already-in-scope practitioner-profile API calls. Confirm this is in
   scope, or if logout/signature-viewing should live somewhere else
   (e.g., folded into Home).
6. **No offline/draft persistence for Log Intervention** is explicitly
   out of scope per the spec, but combined with the idle-logout timer and
   app-backgrounding rules, a practitioner mid-signature who gets
   interrupted for >15 minutes will lose that unsaved encounter entirely.
   Confirm this trade-off is acceptable as-is (it mirrors the web app's
   equivalent risk, just with a mobile-specific trigger — being pulled
   away from the phone mid-visit).
7. **Deep-link scheme for password reset** (universal link vs. custom URL
   scheme vs. PWA install-and-open) depends on the still-undecided native
   vs. PWA packaging choice, which the spec explicitly defers to a later
   stage. This design assumes both a deep-link path and a manual
   token-paste fallback exist regardless of that choice.
8. **Roster search/filter scale**: the spec describes "more than a
   handful of patients" filtered client-side against an already-fetched
   list (no pagination). If a practitioner's roster grows very large, this
   may need server-side pagination/search later — noted as a scale
   concern, not a blocker for this spec's scope.
9. **Home's "attention" prompt for the Inbox** (surfacing un-acknowledged
   rejected/declined logs on the landing screen) is an addition beyond the
   literal stats-card requirement in story 8. Confirm this cross-linking
   is desired, or if Home should show only the three stat values with no
   Inbox cross-reference.
