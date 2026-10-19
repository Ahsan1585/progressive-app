# Records Consent & Disclosure Gating — Design

## Context

The 2026-10-19 FERPA/IDEA Part C compliance audit (see project memory `project_ferpa_compliance_audit.md`) found gap #1: before disclosing a child's records to any third party outside the Part C system, 34 CFR §99.30 & §303.414 require prior written parental consent that records which records, for what purpose, to which specific recipient — plus the ability to revoke at any time (blocking future disclosures immediately) and auto-expiration (default 1 year).

Investigation found exactly one real third-party disclosure point in the app today: `emailSevfToAgency` (`backend/src/controllers/billingController.js`), reachable only by independent practitioners (`independentGuard`), which emails a generated SEVF PDF — and, if present, an invoice PDF — to a billing agency's email address. Unlike agency-mode billing (where one SEVF batch can span multiple children), this independent-practitioner flow groups strictly by `(patient, affiliation, month)` — the code's own comment confirms "one batch per (patient, affiliation, month)" (`generateSelfCertifiedSEVF`, same file) — so every `billing_batches` row this disclosure point touches resolves to exactly one `patient_id`. Gating this disclosure means checking consent for that one child, not a multi-child loop.

Every other outbound email in the app (`sendSessionScheduledEmail`, `sendParentSignatureRequestEmail`) goes to the parent/guardian themselves — not a third party — so none of those need consent. `patientRecordExportController.js`'s record-export PDF is a staff-initiated download, not an automatic third-party send, so it's outside what the system can gate.

The UI for this lives entirely in the **mobile app**: `emailSevfToAgency` is called from `mobile/src/pages/SevfHistory.tsx`, and independent practitioners do their day-to-day patient work on mobile (`mobile/src/pages/PatientDetail.tsx`), not the web `IndependentBilling` screen. Web is untouched by this feature.

This pass builds **staff-logged consent only** — a practitioner records that a parent gave consent (verbally, on paper, or by some other out-of-band means) with a proof note. A parent-facing self-service consent portal is a larger, separate feature (the app has no parent-auth system today) and is explicitly out of scope.

## Goals

- A new `records_consents` table capturing: which patient, which recipient (free text — not limited to the existing `agencies` directory, since the regulation allows "a specific party or class of parties" and a one-off disclosure to e.g. a pediatrician has no existing row anywhere), which record types, purpose, who granted it and when, when it expires (default 1 year from grant, staff-overridable), and revocation state.
- `emailSevfToAgency` checks that an active (not expired, not revoked) consent exists for the batch's one child, covering the recipient and the record types actually being sent (`sevf_forms`, plus `invoices` if an invoice is attached). Missing consent blocks the send with a specific error.
- Mobile UI: a "Consents" section on the patient detail screen to view existing consents (with status: active/expired/revoked) and log a new one; a revoke action per consent. The agency-email dialog in `SevfHistory.tsx` surfaces the blocking error clearly when a send is refused.
- Every consent grant, revocation, and blocked-disclosure attempt is recorded via the existing `logAudit()` mechanism.

## Non-goals

- Parent-facing self-service consent (view/grant/revoke their own) — no parent-auth system exists; this is a future, separate feature.
- Gating any disclosure point beyond `emailSevfToAgency`, since no other third-party disclosure point exists in the app today. The design is general enough (recipient + record types + patient, independent of any specific send action) that a future disclosure point can reuse `records_consents` and the same enforcement helper without a schema change.
- E-signature capture of the consent itself in this pass — `proof_note` is a free-text field (e.g. "signed paper form on file, filed 2026-10-19") rather than a structured e-signature artifact. A compliant e-signature capture flow is gap #6 from the same audit and is a separate piece of work; wiring consent capture to a real e-signature can follow once that exists.
- Web UI for consent management (IndependentBilling screen) — mobile only, matching where this disclosure point and the practitioner's day-to-day patient work both actually live.
- Any UI/enforcement changes for agency-mode (non-independent) companies — the one real disclosure point this closes is independent-practitioner-only.

## Data model

```sql
CREATE TABLE records_consents (
  id serial PRIMARY KEY,
  patient_id integer NOT NULL REFERENCES patients(id),
  recipient_name text NOT NULL,
  purpose text NOT NULL,
  record_types text[] NOT NULL,
  granted_by integer NOT NULL REFERENCES practitioners(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by integer REFERENCES practitioners(id),
  proof_note text,
  CHECK (record_types <@ ARRAY['session_logs','sevf_forms','invoices','full_record_export']::text[]),
  CHECK (cardinality(record_types) > 0)
);
CREATE INDEX records_consents_patient_id_idx ON records_consents (patient_id);
```

`record_types` is a fixed, small enum array matching what the app actually produces — session/service logs, SEVF forms, invoices/billing records, or a full record export — rather than per-document or date-range granularity (simpler to validate and to check against at send time, and matches how disclosures actually happen in this app: a document type going to a recipient, not an arbitrary date slice).

A consent is "active" (usable to satisfy a gate) when `revoked_at IS NULL AND expires_at > now()`. Revoking sets `revoked_at`/`revoked_by`; it is never deleted (the record itself — including its later-revoked state — is part of what a parent could later inspect, same reasoning as the existing child-level Record of Access).

`expires_at` defaults to `granted_at + interval '1 year'` but is a plain, editable column — staff can set a shorter window for a one-off disclosure when creating the record.

## Backend

**New files:**
- `backend/db/migrations/add_records_consents.sql` — the table above, added to `backend/db/migrations/index.js`'s `MIGRATIONS` array.
- `backend/src/controllers/recordsConsentController.js` — `listPatientConsents`, `createConsent`, `revokeConsent`. Each ownership-scoped through the same `patient_practitioners` join pattern as every other per-patient endpoint (including the `deactivated_reason IS DISTINCT FROM 'reassigned'` filter from the just-shipped revocation fix), since a consent is as sensitive as any other patient data.
- `backend/src/routes/recordsConsentRoutes.js` — mounted at `/api/patients/:id/consents` in `backend/index.js`, alongside the existing `agencyRoutes` mount pattern. `GET` / `POST` / `DELETE /:consentId` (revoke, not a hard delete).
- `backend/src/utils/recordsConsent.js` — exports `checkConsent(patientId, recipientName, recordTypes)` returning `{ ok: true, consentId } | { ok: false, reason }` — this is what `emailSevfToAgency` calls before sending. Recipient matching is case-insensitive exact match on `recipient_name` (the agency email's associated name, resolved the same way `SevfHistory.tsx` already resolves `companyAffiliation`/agency name today) — no fuzzy matching, since an exact, intentional recipient name is what the regulation and the UI both require.

**Modified:**
- `backend/src/controllers/billingController.js`'s `emailSevfToAgency` — before calling `sendSevfToAgencyEmail`, resolves the batch's `patient_id` (already selectable via the existing `billing_batches` lookup query — add `a.patient_id` by joining `assessments` on `billing_batch_id = b.id` with `LIMIT 1`, since every assessment in this batch shares one patient), the recipient's display name (reuses whatever name resolution `SevfHistory.tsx` already sends, or falls back to the raw email if no agency name is known), and the record types being sent (`['sevf_forms']`, plus `'invoices'` when `invoiceBuffer` is non-null). Calls `checkConsent`; on `{ ok: false }`, returns `400` with the descriptive `reason` instead of sending. On success, the existing `logAudit('sevf_emailed_to_agency', ...)` call gets `consentId` added to `details`, so the audit trail itself proves which consent authorized which disclosure.

## Mobile

**New:**
- A `Consents` section component (e.g. `mobile/src/components/PatientConsents.tsx`) rendered on `PatientDetail.tsx` — lists existing consents (recipient, purpose, record types as chips, status badge: Active/Expired/Revoked, granted/expires dates), a "Log New Consent" button opening a form (recipient name, purpose, record-type checkboxes, expiration date pre-filled to +1 year, proof note), and a "Revoke" action with a confirmation per active consent.

**Modified:**
- `mobile/src/pages/SevfHistory.tsx`'s email-send handler — on a `400` from `/independent/email-sevf` whose error indicates missing consent, show that error text directly in the dialog (it already names the specific child/reason) rather than the generic failure toast the catch block shows today, and surface a link/button to that child's Consents section so the practitioner can resolve it immediately instead of hunting for where to log one.

## Testing

- Backend: `recordsConsentController` CRUD (ownership scoping including the reassigned-practitioner exclusion, record_types validation, revoke sets the right fields), `recordsConsent.js`'s `checkConsent` (active/expired/revoked/missing cases, case-insensitive recipient match), and `emailSevfToAgency`'s new gate (blocks the send on missing/expired/revoked consent, allows through with valid consent, includes `consentId` in the audit log on success).
- No mobile test infra exists in this repo today (confirmed during investigation) — mobile changes are verified manually per this project's existing practice for mobile UI work, not with new automated tests.

## Review Focus

- A practitioner with consent for THIS child but a DIFFERENT recipient (e.g. consent on file for "ABC Billing" but the send targets "XYZ Agency") — must still block; the check is per-(patient, recipient), not "does this child have any active consent at all."
- An expired-exactly-at-send-time consent (boundary condition on `expires_at > now()`) — should block, not pass.
- A consent revoked, then a *new* consent granted for the same patient/recipient after — the old revoked row must not resurrect and the new row must correctly gate as active.
- `invoiceBuffer` being null (batch has no invoice yet) — the gate must only require `'invoices'` consent when an invoice is actually being attached, not unconditionally.
- A recipient name mismatch by case/whitespace only (e.g. "ABC Billing" vs "abc billing ") — should still match, per the case-insensitive exact-match rule.
