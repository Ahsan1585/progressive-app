# Izaya EIS Security Policies

> **DRAFT FOR ATTORNEY REVIEW. Not legal advice.** Does not state that Izaya is compliant or certified.
> **Status:** Draft v0.1, 2026-10-21, not adopted. **Last reviewed:** [DATE] by [REVIEWER]. **Security Official:** [NAME]. **Designated Confidentiality Official:** [NAME].
> Statuses: "Implemented 2026-10-21, verify in release notes" means built in that day's batch and not yet verified by this drafter.

Applies to: Izaya staff, contractors, platform admins, and (for sections 2-7) agency users of the platform.

## 1. Access control and least privilege

| Rule | How it works | Status |
|---|---|---|
| Unique accounts | One account per person. No shared logins. Invite/activation flow sets the password. | Implemented |
| Role-based permissions | Admin (CEO) plus editable roles built from a fixed list of 15 permission keys (`backend/src/constants/permissions.js`), including `audit_logs` and `patient_record_rights`. | Implemented |
| Caseload scoping | A practitioner sees only children linked in `patient_practitioners` and not marked reassigned. | Implemented |
| Immediate revocation | `is_active` and company status are re-checked on every API request; a deactivated or reassigned user loses access on the next request, not at token expiry. | Implemented |
| BAA acceptance gate | PHI routes return 403 until the agency accepts the agreement (`baa_accepted_at`). The wording is being replaced by the dual-framework agreement in `legal-drafts/02`. | Implemented (gate); text pending attorney |
| Access roster | List of who may access early intervention records, available to the agency (34 CFR 303.415(d)). | Implemented 2026-10-21, verify in release notes |
| Designated Confidentiality Official | Named official per agency (34 CFR 303.415(b)). | Implemented 2026-10-21, verify in release notes |
| Quarterly access review | The agency Admin reviews the roster and permissions each quarter and removes stale access. Izaya reviews its own staff and platform admin accounts quarterly. | Owner action |
| Izaya support access | Platform admins work under named accounts; impersonation sessions expire after 3 hours and are recorded in `audit_logs` details and `platform_audit_logs`. Access only for a customer-requested support reason. | Implemented |

## 2. Authentication and MFA

- Passwords: at least 8 characters with upper, lower, digit and special character (`passwordValidation.js`); stored hashed with bcrypt. [ATTORNEY/OWNER: consider raising length to 12.]
- Login protection: rate limit of 10 attempts per 15 minutes per IP; failed and successful logins and deactivated-account attempts are audit logged.
- MFA: TOTP authenticator-app MFA available to all users; an agency Admin can require it for that agency. Policy: Izaya staff and platform admins must use MFA. Agencies handling child records are expected to enforce it. Implemented 2026-10-21, verify in release notes.
- Recovery: lost-authenticator recovery requires identity verification by the agency Admin or Izaya support, and is logged. [OWNER TO CONFIRM mechanism.]
- Parent signature pages: no-login link, expiring; identity check by child's date of birth. Implemented 2026-10-21, verify in release notes.

## 3. Sessions and idle timeout

| Layer | Setting | Status |
|---|---|---|
| Browser/app lock | 15 minutes idle (mobile warning at 13 minutes; the web app has an idle warning component) | Implemented |
| Server backstop | 30 minutes idle on the server | Implemented 2026-10-21, verify in release notes |
| Token lifetime | Staff JWT 24h; platform admin 12h; impersonation 3h | Implemented |

Users must lock or sign out when leaving a device. Shared or public computers must not be used for the platform.

## 4. Encryption

| Data | Control | Status |
|---|---|---|
| In transit | TLS on Cloud Run and Vercel; HTTP security headers via Helmet; CORS allow-list | Implemented |
| At rest | Google Cloud SQL and Cloud Storage default encryption | Implemented |
| SSN field | AES-256-GCM, versioned format, key in Cloud Run secret `FIELD_ENCRYPTION_KEY` | Implemented |
| Other child PII fields | Application-level encryption | Planned |
| Keys and secrets | Held as Cloud Run secrets; a backup copy of `FIELD_ENCRYPTION_KEY` and `JWT_SECRET` must exist in a separate controlled location. Rotation procedure: [OWNER TO DEFINE]. | Owner action |

## 5. Audit logging and review

- Every sensitive action writes a row to the append-only `audit_logs` table (actor, role, action, resource, details, IP, time). The application has no update or delete path for it.
- Complete logging across record reads, exports, disclosures and consents, with failure-safe behavior (a logging failure is itself surfaced and does not silently drop the event), plus a child-level Record of Access: Implemented 2026-10-21, verify in release notes.
- Review cadence: Security Official reviews anomalies weekly (after-hours access, bulk views, failed logins, impersonation); agency Admins review monthly; full review is part of the annual risk analysis. Record each review in a review log. Owner action.
- Retention: keep audit logs at least 6 years (HIPAA documentation rule) [ATTORNEY TO CONFIRM against Part C retention].
- Audit logs may contain names and identifiers; restrict to the `audit_logs` permission.

## 6. Disclosures

- No disclosure of a child's records outside the Part C system without a valid, unexpired, unrevoked consent matching recipient and record types (`recordsConsent.js`), with identity verification recorded.
- Every disclosure carries a redisclosure notice and is written to the child-level disclosure log.
- No directory information is released. See `06-ferpa-part-c-procedures.md`.
- Email carries no child PII. Records move by expiring secure link (signed URLs valid 1 hour for downloads).

## 7. Devices, downloaded documents and workstations

1. No PHI or child PII may be stored on personal devices outside the app. Do not screenshot, photograph, copy to personal cloud storage, or message child information.
2. PDFs are served for viewing and download only through authenticated sessions; draft and signature responses are served `Cache-Control: no-store`. Billing PDF responses: [OWNER TO CONFIRM no-store is set; add if missing].
3. Downloaded documents (SEVFs, invoices, exports) must be saved only to approved company storage, then deleted from the Downloads folder within 24 hours [OWNER TO CONFIRM].
4. Devices must have a screen lock and current OS updates. Lost or stolen devices are reported to the Security Official within 24 hours (see doc 03). Sign out or revoke by deactivating the user.
5. Do not use real child data in development, testing or demos. Seed tooling must be disabled in production (`ENABLE_TEST_SEED`).
6. Physical controls for Izaya systems are inherited from Google Cloud and Vercel; Izaya maintains no on-premises PHI [OWNER TO CONFIRM].

## 8. Contingency, backup and disaster recovery

| Item | Policy | Status |
|---|---|---|
| Backups | Cloud SQL automated daily backups with point-in-time recovery enabled; retention 7+ days [OWNER TO CONFIRM actual settings] | Owner action |
| Storage | GCS object versioning or equivalent [OWNER TO CONFIRM] | Owner action |
| Recovery objectives | RTO [HOURS], RPO [HOURS] | Owner action |
| Restore test | At least annually; result filed with date and who ran it | Owner action |
| Emergency mode | If the platform is down, practitioners record sessions on paper forms and enter later; no PHI by text or personal email | Owner action (communicate) |
| Code and config | Source in git; Cloud Run revisions allow rollback | Implemented |
| Secrets recovery | Keys backed up per section 4 | Owner action |

## 9. Sanctions

Workforce members who violate these policies face sanctions proportionate to the violation: retraining and written warning (inadvertent), suspension of access (negligent or repeated), termination and referral to authorities (willful, such as snooping, selling or leaking data). Sanctions are documented by the Security Official and kept 6 years. Good-faith reporting is not penalized.

## 10. Vendor management

No vendor may receive child PII until: (a) listed in `05-vendor-baa-checklist.md`; (b) a BAA or equivalent written agreement is in place, or the vendor is blocked from receiving child data by design and tested; (c) the Security Official approves. Review the vendor list annually and at each new integration. Resend currently cannot sign a BAA and must never receive child PII.

## 11. Change management

1. All changes go through git with review before production.
2. Changes touching auth, access, logging, encryption, email or disclosure need a second reviewer and a note in release notes.
3. Run the automated tests (Jest in backend, Vitest in frontend/mobile) before deploy; all pending changes must be committed first, since only committed state ships.
4. Verify that a new Cloud Run revision actually serves traffic after deploy.
5. Database migrations are idempotent and run per tenant at boot (`runMigrations.js`).
6. Any new data field containing child information, new email template, or new third-party service triggers a risk analysis update (doc 01) and vendor check (doc 05).
7. Emergency changes are documented within 2 business days.

## 12. Policy ownership and review

Security Official: [NAME]. Review annually and after incidents. Keep prior versions 6 years.
