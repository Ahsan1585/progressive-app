# Practitioner Mobile App

## Problem statement

Progressive Steps NJ practitioners currently do all of their field work — logging
NJEIS home-visit encounters, capturing parent/practitioner signatures, tracking
their patient roster, and resolving billing rejections — on a desktop web app
that is only responsively squeezed down for phones. Practitioners do this work
standing in a family's living room or between visits on their phone, where a
shrunk desktop layout (small tap targets, dense tables, a signature canvas
sized for a mouse) is a poor fit. This spec defines a new, dedicated
mobile-first application, `mobile/`, that reproduces the existing practitioner
scope end-to-end against the existing, unmodified backend API, re-optimized for
one-handed phone use in the field — with no changes to the admin/billing
portal, backend routes, or database.

## User stories

1. As a practitioner, I want to log in with my email and password on my phone,
   so that I can access my patient roster and encounter history in the field.
2. As a practitioner who was just provisioned by an admin, I want to be forced
   through a password-change screen on my first login, so that I'm never
   working under a temporary, admin-set password.
3. As a practitioner who forgot my password, I want to request and complete a
   reset via an emailed link, so that I can regain access without calling an
   admin.
4. As a practitioner, I want to add a new patient by entering their 9-digit
   NJEIS Child ID and demographics, and search/filter my existing roster, so
   that I can quickly find or create the right patient record on site.
5. As a practitioner, I want to see a patient's full intervention/encounter
   history when I select them, so that I have context before logging a new
   visit or checking on a past one.
6. As a practitioner, I want to log a new intervention — date, start/end time
   with an auto-computed total, service/status/location codes, and parent +
   my own signature captured on the phone screen (or my saved default
   signature) — so that I can complete NJEIS documentation immediately after a
   visit, on the device I already have in hand.
7. As a practitioner, I want a single inbox of my rejected/declined logs where
   I can revise-and-resubmit a returned log or acknowledge a declined one with
   an optional note, so that I can resolve billing feedback without hunting
   through my full history.
8. As a practitioner, I want a quick-glance stats card (logs this month, hours
   this month, logs still in the billing pipeline), so that I know my
   productivity and outstanding-log status at a glance.
9. As a practitioner, I want to be automatically logged out after 15 minutes
   of inactivity, so that patient PHI on my phone isn't exposed if I leave the
   app open.

## Acceptance criteria

### 1. Login (practitioner only)
- Given a practitioner with valid credentials and `role = practitioner`,
  when they submit email + password on the mobile login screen, then
  `POST /api/auth/login` succeeds, a JWT is stored on-device, and they land on
  the roster/home screen.
- Given invalid credentials, when the practitioner submits the login form,
  then a generic "Invalid credentials" error is shown (no hint as to whether
  the email exists), matching the API's response.
- Given a deactivated account (`is_active = false`), when login is attempted,
  then the app surfaces the "account deactivated, contact your administrator"
  message returned by the API and does not store a token.
- Given the mobile app has no admin-role UI at all, when any user
  authenticates, then the app treats `role` values other than `practitioner`
  (e.g. `ceo`, `billing`, `staff_director`) as unsupported for this app and
  blocks entry with a clear "this app is for practitioners only" message
  rather than attempting to render any admin screen.

### 2. Forced first-login password change
- Given a login response with `requirePasswordChange: true`, when the
  practitioner reaches the home screen, then they are redirected to a
  change-password screen and cannot navigate to the roster/log-intervention
  screens until it is completed.
- Given the practitioner submits a new password meeting the strength rule
  (min 8 chars, upper, lower, digit, special character), when
  `POST /api/auth/change-password` succeeds, then the flag is cleared and the
  practitioner is taken to the normal home screen.
- Given the practitioner submits a password that fails the strength rule,
  when they submit the form, then the app blocks submission client-side with
  the same rule text the API enforces, and shows the API's error verbatim if
  the server-side check also fails.

### 3. Forgot / reset password
- Given a practitioner on the login screen taps "Forgot password" and submits
  an email, when `POST /api/auth/forgot-password` returns its generic success
  message, then the app shows that exact generic message regardless of
  whether the email exists in the system.
- Given the practitioner follows the emailed reset link (deep link or
  copy/paste of the token into the mobile app) within 30 minutes, when they
  submit a new valid-strength password, then `POST /api/auth/reset-password`
  succeeds and they can log in with the new password.
- Given the reset token is expired or invalid, when the practitioner submits
  a new password, then the app shows "this reset link is invalid or expired"
  and offers a path back to requesting a new one.

### 4. Patient roster: add, search/filter, select
- Given a practitioner on the roster screen, when they enter first/last name,
  DOB, county, and a Child ID, then the Child ID field is validated client-side
  as exactly 9 digits before submission, matching the server's Zod rule.
- Given a valid new-patient form, when submitted, then
  `POST /api/patients/register` succeeds, the new patient appears in the
  roster list, and the practitioner is returned to (or automatically lands
  on) that patient's detail view.
- Given a Child ID that is not exactly 9 digits, when the practitioner
  attempts to submit, then the app blocks submission and shows the "Child ID
  must be exactly 9 digits" message without a round trip to the server.
- Given the practitioner's roster has more than a handful of patients, when
  they type into a search box or apply a filter, then the visible list narrows
  by name (and Child ID if entered) using the roster data already fetched via
  the patients list endpoint, with results updating as they type.
- Given the practitioner taps a patient row, when the tap registers, then the
  app navigates to that patient's detail/history screen scoped to that
  patient only (server-enforced by `practitioner_id` ownership).

### 5. Per-patient intervention/encounter history
- Given a practitioner has selected a patient, when the detail screen loads,
  then it fetches and displays that patient's assessments (date, type,
  status, location, billing status) ordered most-recent-first, matching
  `GET /api/patients/:id/assessments`.
- Given a patient has zero prior encounters, when their detail screen loads,
  then an explicit empty state is shown instead of a blank list.
- Given the practitioner is not the owner of a patient ID (should not be
  reachable via normal navigation), when the app calls the assessments
  endpoint for it, then the 403 response is handled gracefully (error state,
  no crash) rather than assumed to always succeed.

### 6. Log Intervention flow
- Given a practitioner opens "Log Intervention" for a selected patient, when
  they enter a start time and an end time, then the app auto-computes and
  displays total time without requiring manual entry.
- Given the form, when the practitioner selects a service type code, status
  code, and location code, then only the documented NJEIS vocabularies are
  offered (19 service type codes, 5 status codes, 8 location codes, as
  currently hard-coded in the existing dashboard) — no new codes invented.
- Given the practitioner has a previously saved default signature
  (`GET /api/practitioner/profile` → `signature`/`saved_signature`), when they
  reach the signature step, then they are offered a one-tap "use my saved
  signature" option as an alternative to drawing a fresh one.
- Given the practitioner draws a new signature and opts to save it as their
  default, when they submit, then `POST /api/practitioner/signature` is
  called to persist it for future reuse.
- Given both parent and practitioner signatures are captured (drawn on a
  touch-optimized canvas sized for the device screen, or reused from saved
  default) and all required fields are filled, when the practitioner submits,
  then `POST /api/interventions` is called with the patient/practitioner
  ownership fields, date, start/end time, computed total time, service type,
  status, location, and both signatures as base64 PNG data, and on success the
  new log appears at the top of that patient's history.
- Given any required field (date, start/end time, service type, status,
  location, or either signature) is missing, when the practitioner attempts
  to submit, then submission is blocked client-side with a field-level
  indication of what's missing.

### 7. Rejected/returned logs inbox
- Given a practitioner opens the "Rejected/Returned" inbox, when it loads,
  then it fetches `GET /api/patients/rejected-logs` and lists only
  un-acknowledged logs with `billing_status` of `rejected` or `declined`,
  each showing the billing note and rejection date.
- Given a log with `billing_status = rejected` ("returned"), when the
  practitioner opens it, then they can edit type, location, start/end time,
  total time, and status, and on submit `POST /api/patients/resubmit-log` is
  called with the assessment ID and revised fields, moving it back to
  `pending` and removing it from the inbox.
- Given a log with `billing_status = declined` (terminal), when the
  practitioner opens it, then they are only offered an "acknowledge" action
  with an optional free-text response note (not an edit form), and
  `POST /api/patients/acknowledge-log` is called with the assessment ID and
  optional `response`, removing it from the inbox on success.
- Given the practitioner attempts to resubmit a log that is not currently in
  `rejected` state, or acknowledge one not in `rejected`/`declined` state
  (e.g. a race with a concurrent admin action), when the API returns its
  error, then the app shows that error and refreshes the inbox rather than
  assuming success.

### 8. Quick stats card
- Given the practitioner reaches the home/dashboard screen, when it loads,
  then it calls `GET /api/patients/practitioner-stats` and displays logs this
  month, hours this month (total_time minutes summed and converted to
  hours), and the count of logs still in the pipeline (`pending` or
  `njeis_review` status), matching the API's field names and definitions
  exactly.
- Given the stats endpoint has not yet returned, when the card renders, then
  it shows a loading state rather than a flash of zero/empty values.

### 9. Idle auto-logout
- Given a practitioner is authenticated and the app is in the foreground with
  no touch/scroll/keyboard interaction, when 15 minutes elapse, then the
  session is cleared (token discarded) and the practitioner is returned to
  the login screen, mirroring the existing web app's `IdleLogout` behavior.
- Given the practitioner interacts with the app (tap, scroll, type) at any
  point, when that interaction occurs, then the 15-minute idle timer resets.
- Given the app is backgrounded (user switches apps or locks the phone), when
  it is foregrounded again, then the elapsed background time counts toward
  the idle timeout so a practitioner can't leave the app open in the
  background indefinitely without being logged out.

## Out of scope

- The entire Admin Portal: Billing Manager (pending bills, SEVF/NJEIS
  generation, invoice generation, completed bills vault, batch revert),
  Practitioners/staff management tab (provisioning, role changes,
  deactivate/reactivate), and Reports/Master Reports tab (audit logs,
  compliance flags, invoice override).
- Any `ceo`, `staff_director`, or `billing` role logic or UI — this app has
  exactly one role, `practitioner`, and treats any other role as unsupported.
- Any backend, database, or API changes. The mobile app is a new client only,
  consuming the existing REST API exactly as documented above; no new
  endpoints, no schema changes.
- Deleting patients (`DELETE` patient endpoint exists server-side but is not
  required by this spec's user stories; include only if later explicitly
  requested).
- PDF generation, viewing, or downloading of any kind (NJEIS/SEVF forms,
  invoices) — that is exclusively an admin/billing capability today.
- Push notifications, offline/local-first data sync, or background
  submission queues — not part of the current web app's behavior and not
  required to replicate it.
- Native platform packaging decisions (React Native vs. installable PWA vs.
  other), UI component choices, navigation library choices, and visual
  design/branding — those are implementation-stage decisions for later specs,
  not this one.
- Multi-practitioner/shared-device support, biometric login, or any auth
  mechanism beyond what `/api/auth/*` already provides.
