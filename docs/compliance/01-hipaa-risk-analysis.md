# HIPAA Security Risk Analysis (applied to all child data)

> **DRAFT FOR ATTORNEY REVIEW. Not legal advice.** Does not state that Izaya is compliant or certified.
> **Status:** Draft v0.1, 2026-10-21. **Last reviewed:** [DATE] by [REVIEWER]. **Security Official:** [NAME, TO BE APPOINTED].
> Scope note: NJEIS early intervention records are likely governed by IDEA Part C and FERPA, not HIPAA PHI (see `legal-drafts/RESEARCH-BRIEF.md`). This analysis follows the HIPAA Security Rule methodology as the common baseline because it covers non-NJEIS PHI and is a recognized standard of care. Items marked "Implemented 2026-10-21" must be verified against release notes.

## 1. Asset inventory

| Asset | What it holds | Where | Data class |
|---|---|---|---|
| Platform DB `izaya_platform` | Company registry, subscription state, `baa_accepted_at`, platform admin accounts | Google Cloud SQL (Postgres) | No child data by design; business and account data |
| Tenant databases (one per agency) | Patients (child name, DOB, parent contact, SSN field encrypted), sessions/assessments, signatures, consents, correction requests, `audit_logs`, practitioner accounts | Google Cloud SQL | Child PII / early intervention records, highest sensitivity |
| GCS buckets `njeis-forms`, `njeis-billing-invoices` (names overridable by env) | Generated SEVF PDFs, invoices, compliance documents; object paths prefixed by tenant DB name | Google Cloud Storage | Child PII |
| Backend API | Express on Cloud Run; JWT auth; Puppeteer PDF generation inside the container | Google Cloud Run | Processes child PII in memory |
| Web app (React) | Office staff and admin UI; token in browser localStorage | Vercel (static hosting) | Child PII displayed in browser; none stored server-side at Vercel |
| Practitioner mobile PWA | Session logging, signatures, drafts | Vercel (static) plus practitioner phone browser | Child PII displayed; token and practitioner profile in localStorage; drafts are fetched from the API with no-store |
| Real-time messaging | Socket.io inside the API | Cloud Run | In-app messages; may contain child references [OWNER TO CONFIRM] |
| Email (Resend) | Account invites, resets, signature request links, signup confirmations | Resend | Intended: no child PII (links and non-child content only) |
| Payments (Stripe) | Subscription billing for agencies and practitioners | Stripe | Business and payer data, not child data |
| Instagram integration (Composio) | Marketing posts | Composio | No child data |
| Secrets | `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, DB password, API keys | Cloud Run secrets | Critical |
| Staff and practitioner devices | Browsers, phones | Personal and company devices | Transient display of child PII |
| Local developer machines | Source code, possibly test data | Developer laptops | Should hold no real child data [OWNER TO CONFIRM] |

## 2. Data flows

1. **Practitioner phone to API to Cloud SQL.** Phone (HTTPS/TLS) to Cloud Run API (JWT bearer token, per-request `is_active` and company status check) to tenant DB via per-tenant connection pool. Caseload scoping via `patient_practitioners`.
2. **Office web app to API to Cloud SQL.** Same path, permission-gated by role.
3. **PDF generation.** API generates SEVF/invoice PDFs (Puppeteer, pdf-lib), stores them in GCS under a tenant prefix, and hands the browser a signed GCS URL valid 3600 seconds (`getSignedUrl` calls in `billingController.js`).
4. **Disclosure to an agency.** Intended end state: SEVFs go to the agency by expiring secure link, not attachment; each disclosure carries a redisclosure notice and is written to the child-level disclosure log. Current code before the 2026-10-21 batch attached the PDF via Resend (`sendSevfToAgencyEmail`); that path must be confirmed removed.
5. **Email.** API to Resend to recipient. Intended content: links and non-child text. Before the batch, `sendSessionScheduledEmail` included the child's first name, session date/time and a `.ics` file; confirm this is removed or de-identified.
6. **Parent signature (telepractice).** API emails a link; the parent opens a no-login page, verifies DOB (Implemented 2026-10-21), signs, and the signature is stored in the tenant DB.
7. **Payments.** API to Stripe for subscription charges (company metadata only).
8. **Platform operations.** Platform admins authenticate against `platform_admins` (JWT 12h), can mint a 3h impersonation session; actions go to `platform_audit_logs`.

## 3. Threat and vulnerability list

Likelihood (L) and impact (I): Low / Medium / High. "Residual" is after the control in column 5.

| ID | Threat or vulnerability | L | I | Control or remediation | Residual |
|---|---|---|---|---|---|
| T1 | Stolen or phished credentials | M | H | bcrypt hashing, password strength rule, login rate limit (10/15 min/IP), TOTP MFA (Implemented 2026-10-21), per-agency MFA enforcement | Medium until MFA is enforced for all agencies |
| T2 | Token theft from browser localStorage (XSS or shared device) | L-M | H | Helmet headers; 24h JWT; 15 min client idle lock; 30 min server idle backstop (Implemented 2026-10-21). Token still lives in localStorage | Medium. Remediation: move to httpOnly cookies or shorten token life [OWNER] |
| T3 | Unattended unlocked device | M | M | Idle lock (client) and server-side idle timeout (Implemented 2026-10-21) | Low |
| T4 | Insider snooping beyond caseload | M | H | Caseload scoping; roles/permissions; complete audit logging and child-level Record of Access (Implemented 2026-10-21); review cadence in doc 02 | Low-Medium |
| T5 | Departed or reassigned staff retains access | M | H | `is_active` checked per request; immediate revocation on deactivation or reassignment | Low |
| T6 | Child PII sent to a vendor without a BAA (Resend) | M | H | Engineering fixes 2026-10-21 (verify): no child PII in any email; SEVF by expiring link; written vendor decision | Low once verified. Owner action: test and record |
| T7 | Disclosure to unauthorized third party | M | H | Consent gate (recipient name and email match, expiry, revocation, record-type match); identity verification (Implemented 2026-10-21); redisclosure notice | Low |
| T8 | Database or backup compromise exposing plaintext | L | H | Cloud SQL encryption at rest; SSN field encryption (AES-256-GCM). Other child PII fields are plaintext at application level | Medium. Planned: application-level encryption of child PII fields |
| T9 | Loss of `FIELD_ENCRYPTION_KEY` or `JWT_SECRET` | L | H | Cloud Run secrets; key backup procedure stated in `fieldEncryption.js` comments | Medium until backup location is recorded [OWNER TO CONFIRM] |
| T10 | Cross-tenant data exposure | L | H | Per-tenant databases; per-tenant GCS path prefix applied centrally in `storage.js`; tenant context via AsyncLocalStorage | Low. Add periodic cross-tenant test [OWNER] |
| T11 | Audit log failure goes unnoticed or logs are tampered with | M | M | Append-only from the app (no UPDATE/DELETE path); failure-safe complete logging (Implemented 2026-10-21). DB admins can still modify rows | Medium. Planned: log export to separate store [OWNER] |
| T12 | Signed PDF URL forwarded or leaked | M | M | 1-hour expiry; URLs generated only for authenticated, tenant-scoped requests | Low-Medium |
| T13 | PDFs cached on personal devices | M | M | Drafts and signature responses send `Cache-Control: no-store`. A global no-store header for billing PDF downloads was not found in code. | Medium [OWNER TO CONFIRM, add header] |
| T14 | Platform admin or support impersonation abuse | L | H | Separate `platform_admins` accounts, 3h impersonation tokens, `platform_audit_logs`, impersonation recorded in `audit_logs.details` | Low-Medium. MFA for platform admins [OWNER TO CONFIRM] |
| T15 | Ransomware or destructive error; data loss | L | H | Cloud SQL backups [OWNER TO CONFIRM settings]; restore test | Medium until restore test recorded |
| T16 | Availability loss (Cloud Run, Cloud SQL, Vercel outage) | M | M | Managed platforms; contingency plan in doc 02 | Medium. Offline procedure [OWNER] |
| T17 | Malicious or vulnerable dependency | M | M | Lockfiles; Jest tests; no automated dependency scanning confirmed | Medium. Add dependency audit to CI [OWNER] |
| T18 | Phishing of workforce | M | H | Training (doc 04), MFA | Medium until training completed |
| T19 | Test or seed data containing real child data | L | M | `ENABLE_TEST_SEED` env flag; seed actions audit logged | Low [OWNER TO CONFIRM prod flag off] |
| T20 | Untimely breach detection and notification | M | H | Doc 03 runbook; audit logs | Medium until tabletop exercise done |
| T21 | Missed Part C duties (10-day access, hearing, destruction) | M | M | Request tracker (Implemented 2026-10-21); hearing tracking and destruction workflow Planned | Medium. See register |
| T22 | Unapproved vendor or subprocessor added | L | H | Vendor checklist (doc 05) and change management (doc 02) | Low |
| T23 | No third-party assurance (no SOC 2) | H | M | Planned SOC 2; do not claim | Accepted, disclose accurately |

## 4. Control summary against Security Rule families

See the status matrix in `00-README.md` section A for the full standard-by-standard mapping.

## 5. Methodology and review

1. Identify assets and data flows (sections 1 and 2).
2. Identify threats and vulnerabilities (section 3).
3. Rate likelihood and impact, record controls and residual risk.
4. Treat: implement, accept (owner-signed), transfer, or avoid.
5. Re-run annually, and after any major change (new vendor, new data type, incident).

## 6. Residual risk register

| ID | Residual risk | Owner | Treatment | Target date | Status |
|---|---|---|---|---|---|
| R1 | Child PII fields other than SSN not encrypted at application level (T8) | [OWNER] | Planned build | [DATE] | Open |
| R2 | JWT in localStorage (T2) | [OWNER] | Evaluate httpOnly cookie sessions | [DATE] | Open |
| R3 | Verify 2026-10-21 batch in release notes and production (T1, T3, T4, T6, T7, T11) | [OWNER] | Verification pass, record evidence | [DATE] | Open |
| R4 | Resend: written decision and test proving no child data in email (T6) | [OWNER] | Owner action | [DATE] | Open |
| R5 | Backup and restore test not recorded (T15) | [OWNER] | Run test, file result | [DATE] | Open |
| R6 | Retention and destruction workflow missing (T21) | [OWNER] | Planned build; interim manual procedure | [DATE] | Open |
| R7 | Hearing and Statement of Disagreement tracking missing (T21) | [OWNER] | Planned build | [DATE] | Open |
| R8 | Key backup location for `FIELD_ENCRYPTION_KEY`/`JWT_SECRET` unrecorded (T9) | [OWNER] | Document | [DATE] | Open |
| R9 | No dependency scanning (T17) | [OWNER] | Add CI step | [DATE] | Open |
| R10 | Billing PDF no-store header (T13) | [OWNER] | Add header | [DATE] | Open |
| R11 | Platform admin MFA (T14) | [OWNER] | Confirm and enable | [DATE] | Open |
| R12 | No SOC 2 report (T23) | [OWNER] | Planned | [DATE] | Accepted |
| R13 | Workforce training not yet delivered (T18) | [OWNER] | Deliver, record | [DATE] | Open |

Accepted risks must be signed: [OWNER SIGNATURE] [DATE].
