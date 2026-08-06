# Session Log Drafts — Design

## Context

Logging a session today (`mobile/src/pages/LogIntervention.tsx`) requires every field to be complete before anything can be saved — including both the parent's and the practitioner's signature, which are `NOT NULL` at the database level (`assessments.parent_signature`/`practitioner_signature`). A practitioner who gets interrupted mid-log (parent isn't available to sign yet, session runs long, connectivity drops) loses everything they'd already filled in.

This adds the ability to save an incomplete session log as a **draft** and resume it later, without touching the requirements for a real, submitted session log.

## Scope

- **Mobile app only** for this pass (`mobile/`). The web app's `LogInterventionModal.jsx` gets no changes here — it can get the same capability later as a separate, follow-up spec if wanted.
- Drafts are **server-side**, not local-device-only — they follow the practitioner across devices/browsers and survive clearing local storage.

## Data model

A new table, entirely separate from `assessments` — so a draft is structurally incapable of leaking into billing, Compliance Analysis, or Master Reports, all of which only ever query `assessments`:

```sql
CREATE TABLE session_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id integer NOT NULL REFERENCES practitioners(id),
  patient_id integer NOT NULL REFERENCES patients(id),
  form_data jsonb NOT NULL,        -- mirrors LogIntervention's form state: date, start/end time, service type,
                                    -- status, location, custom dropdown-category fields, notes
  parent_signature text,           -- nullable, unlike assessments.parent_signature
  practitioner_signature text,     -- nullable, unlike assessments.practitioner_signature
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practitioner_id, patient_id)
);
```

- **One draft per (practitioner, child) pair.** Saving a new draft for a child that already has one overwrites it (upsert on the unique constraint) — matches "a practitioner can have drafts in progress for several different children at once, but only one per child."
- Every field except the ownership links (`practitioner_id`, `patient_id`) is nullable — a draft can be as bare as just a patient selected with nothing else filled in yet.
- No CHECK constraints mirroring the real `assessments` validation — a draft is allowed to be incomplete or even internally inconsistent (e.g., an end time before a start time) since it's never billed or reported on directly.

## Retention

Drafts are cleaned up via the same **lazy-sweep pattern** already used for the 90-day compliance-reference-data retention (`billingController.js`'s `getComplianceAnalysis`) rather than a new Cloud Scheduler job:

```sql
DELETE FROM session_drafts WHERE updated_at < now() - interval '30 days';
```

This runs once at the top of `GET /api/session-drafts` (the list-drafts endpoint, called every time the Home screen loads), before the real read — so stale, forgotten drafts age out automatically the next time anyone checks, with no new infrastructure.

## API

All four endpoints are `protect`-gated (existing auth middleware) and scoped to the requesting practitioner (`req.practitioner.practitionerId`) — a practitioner can only ever see/modify their own drafts.

- **`POST /api/session-drafts`**
  Body: `{ patientId, formData, parentSignatureBase64?, practitionerSignatureBase64? }`.
  Upserts (`ON CONFLICT (practitioner_id, patient_id) DO UPDATE`) the draft for this practitioner+patient. Ownership check mirrors `/api/interventions`'s existing `patient_practitioners` lookup — the patient must actually belong to this practitioner.

- **`GET /api/session-drafts`**
  Runs the 30-day sweep, then returns every draft belonging to this practitioner: `[{ patientId, patientFirstName, patientLastName, updatedAt }]` — enough for the Home screen's "Continue where you left off" card.

- **`GET /api/session-drafts/:patientId`**
  Returns the full draft (`formData` + both signature fields, if present) for pre-filling `LogIntervention` when the practitioner opens that child's log screen. Returns `404`/`null` if no draft exists — a normal, expected case (most children won't have one).

- **`DELETE /api/session-drafts/:patientId`**
  Explicit discard — removes the draft row outright.

**On final submit:** `POST /api/interventions`, after successfully inserting the real `assessments` row, also runs `DELETE FROM session_drafts WHERE practitioner_id = $1 AND patient_id = $2` in the same request — the draft disappears the instant it becomes a real, submitted log. No separate client-side cleanup call needed.

## Mobile UI

**`LogIntervention.tsx`**
- On mount, calls `GET /api/session-drafts/:patientId` and pre-fills the form (including any already-captured signature) if a draft exists for this child — landing on this screen always reflects whatever was last saved for that child, whether that's a draft or a blank form.
- A new **"Save Draft"** button, next to the existing Submit button, calls `POST /api/session-drafts` with whatever the form currently holds. Unlike Submit, this has **no validation gate** — every one of the existing required-field checks (date, times, service type, status, location, required custom fields, both signatures) only applies to Submit, never to Save Draft.
- Save Draft is always available, regardless of how complete the form already is — even a fully-filled-in form can still be saved as a draft (e.g., the practitioner wants to double-check something before final Submit). It's never hidden or disabled based on field completeness.
- Submit's behavior and validation are otherwise completely unchanged.

**Home screen** (`Home.tsx` + `AppDataContext`)
- New `drafts` / `draftsLoading` / `fetchDrafts` state, added to `AppDataContext` following the exact same shape as the existing `rejectedLogs` state, and fetched in `Home`'s existing `useEffect` alongside `fetchStats`/`fetchRejectedLogs`/etc.
- A new **"Continue where you left off"** card section, listing each draft (child name, last-edited time, relative like "2 hours ago"). Tapping a row navigates to `/patients/:id/log`, which then auto-loads that draft per the `LogIntervention` behavior above.
- Hidden entirely when there are zero drafts (no empty-state card).

**Patient Detail** (`PatientDetail.tsx`)
- A **"Resume draft"** banner shown when `GET /api/session-drafts/:patientId` for this specific child returns a draft, linking to `/patients/:id/log`.

## Error handling

- **Save Draft failure** (network error, server error): show an inline error via the existing toast/banner pattern already used elsewhere in `LogIntervention.tsx`; the form's local state is untouched either way, so nothing is lost from the practitioner's perspective even if the save itself failed — they can just retry.
- **Draft fetch failure on mount:** fails silently to a blank form (same as if no draft existed) rather than blocking the screen — logging a fresh session must never be blocked by a draft-loading problem.
- **Ownership violation** (a patientId that doesn't belong to the requesting practitioner): all four endpoints return `403`, mirroring the existing ownership check pattern in `/api/interventions`.

## Testing

- Save a partial draft (missing signatures), confirm it appears on Home and Patient Detail, confirm reopening `LogIntervention` for that child pre-fills exactly what was saved.
- Submit a session for a child with an existing draft; confirm the draft disappears from Home/Patient Detail afterward (deleted server-side) and the real assessment appears normally in the billing queue.
- Confirm a draft's incomplete/missing signature never appears anywhere in Compliance Analysis, Master Reports, or the billing queue (structurally true given the separate table, but worth a live check).
- Confirm two different children's drafts for the same practitioner coexist independently (save one, confirm the other is untouched).
- Confirm saving a second draft for the same child overwrites the first (upsert), rather than erroring or duplicating.
- Confirm a draft older than 30 days is gone the next time `GET /api/session-drafts` runs.
