# Izaya EIS Compliance Documentation Set: Index and Status Matrix

> **DRAFT FOR ATTORNEY REVIEW. Not legal advice. Not adopted.**
> **Status:** Draft v0.1, prepared 2026-10-21 from a read-only review of the codebase and `legal-drafts/RESEARCH-BRIEF.md`.
> **Last reviewed:** [DATE] by [REVIEWER]. **Approved by:** [OWNER NAME / ATTORNEY NAME].
> Nothing here states or implies that Izaya "is compliant" or "certified" under HIPAA, FERPA or IDEA Part C. These documents describe intended controls. Public claims should be limited to what an attorney approves after review.

## How to read this set

Items marked **Implemented 2026-10-21, verify in release notes** were being built on the day this set was drafted. Confirm each against the actual release notes and code before relying on it. Items marked **Planned** do not exist yet. `[OWNER TO CONFIRM]` marks a fact the drafter could not verify from code.

Framework layering (from the research brief): IDEA Part C first (34 CFR 303.400-.417), FERPA second (34 CFR Part 99, incorporated by Part C), HIPAA wherever it actually applies (non-NJEIS PHI, electronic billing transactions, mixed records). FERPA-covered records are generally excluded from HIPAA PHI (45 CFR 160.103), so the HIPAA Security Rule matrix below is applied voluntarily to all data as the common baseline.

## Documents

| File | Purpose |
|---|---|
| `01-hipaa-risk-analysis.md` | Asset inventory, data flows, threats, residual risk register |
| `02-security-policies.md` | Access, authentication/MFA, sessions, encryption, logging, devices, sanctions, contingency, vendors, change management |
| `03-incident-response-and-breach-notification.md` | Roles, severities, breach clocks, runbook, notice template |
| `04-workforce-training-outline.md` | Training modules and sign-off sheet |
| `05-vendor-baa-checklist.md` | Every vendor found in code, data class, agreement status, action |
| `06-ferpa-part-c-procedures.md` | Annual notice, inspection, amendment, consent, redisclosure, retention, school-official language |
| `07-hhs-405d-adoption.md` | Adoption of HHS 405(d) HICP practices and evidence checklist |
| `../../legal-drafts/` | Customer-facing drafts (ToS, data agreement, parent notice, privacy policy) and the research brief. Not edited by this set. |

## Status legend

**Implemented** = exists in code in production before 2026-10-21. **Implemented 2026-10-21** = built in the 2026-10-21 batch, verify in release notes. **Planned** = not built. **Owner action** = a human task or paper record, not software.

## A. HIPAA Security Rule (45 CFR Part 164 Subpart C)

| Standard | Control in product or document | Status | Evidence location |
|---|---|---|---|
| 164.308(a)(1)(ii)(A) Risk analysis | `01-hipaa-risk-analysis.md` | Owner action (adopt, review annually) | doc 01; signed adoption page [OWNER TO CONFIRM] |
| 164.308(a)(1)(ii)(B) Risk management | Residual risk register with target dates | Owner action | doc 01 section 6 |
| 164.308(a)(1)(ii)(C) Sanction policy | Policy in doc 02 section 9 | Owner action (adopt) | doc 02 |
| 164.308(a)(1)(ii)(D) Information system activity review | Append-only `audit_logs`; review cadence in doc 02 | Implemented (log); review cadence is Owner action | `backend/src/utils/auditLog.js`, `audit_logs` table, `GET /api/audit-logs` |
| 164.308(a)(2) Assigned security responsibility | Security Official appointment | Owner action | appointment record [OWNER TO CONFIRM] |
| 164.308(a)(3) Workforce security (authorization, clearance, termination) | Roles/permissions; immediate deactivation check on every request | Implemented | `authMiddleware.js` (`is_active` re-checked per request), `constants/permissions.js` |
| 164.308(a)(4) Information access management | Caseload-scoped access; 15 permission keys; BAA gate | Implemented | `patient_practitioners` joins in `patientController.js`; `permissions.js` |
| 164.308(a)(5) Security awareness and training | `04-workforce-training-outline.md` | Owner action (deliver, record dates) | sign-off sheets |
| 164.308(a)(6) Security incident procedures | `03-incident-response-and-breach-notification.md` | Owner action (adopt, tabletop) | doc 03 |
| 164.308(a)(7) Contingency plan (backup, DR, emergency mode, testing) | Doc 02 section 8; Cloud SQL backups | Implemented (platform backups) / Owner action (restore test) [OWNER TO CONFIRM backup/PITR settings] | GCP console, doc 02 |
| 164.308(a)(8) Evaluation | Annual review in docs 01 and 07 | Owner action | review log |
| 164.308(b) Business associate contracts | Google BAA signed (owner statement); Resend excluded from child data; others per doc 05 | Owner action (BAA copy on file) | doc 05; BAA PDF [OWNER TO CONFIRM] |
| 164.310(a) Facility access controls | Inherited from Google Cloud and Vercel data centers; Izaya has no on-premises PHI [OWNER TO CONFIRM] | Owner action (collect Google attestation) | Google compliance reports |
| 164.310(b) Workstation use | Doc 02 section 7 | Owner action (adopt) | doc 02 |
| 164.310(c) Workstation security | Doc 02 section 7; idle lock | Implemented (idle lock) / Owner action | `frontend/src/components/IdleTimeoutWarning.jsx`, `mobile/src/hooks/useIdleTimer.ts` |
| 164.310(d) Device and media controls | No PHI stored on devices outside the app; no-store on drafts and signature responses | Implemented in part; PDF no-store header not found in billing download path [OWNER TO CONFIRM] | `sessionDraftsController.js`, `telepracticeSignatureController.js` |
| 164.312(a)(1) Access control: unique user ID | Per-user accounts, JWT identity | Implemented | `authController.js` |
| 164.312(a)(2)(iii) Automatic logoff | Client idle lock (15 min mobile, web idle warning); server-side 30 min backstop | Client: Implemented. Server backstop: Implemented 2026-10-21, verify in release notes | `useIdleTimer.ts`, release notes |
| 164.312(a)(2)(iv) Encryption and decryption | Cloud SQL encryption at rest; SSN field AES-256-GCM | Implemented. App-level encryption of other child PII: Planned | `utils/fieldEncryption.js` |
| 164.312(b) Audit controls | Append-only `audit_logs`; failure-safe, complete logging; child-level Record of Access | Implemented (base); Implemented 2026-10-21 (completeness, failure-safe, child-level log) | `auditLog.js`, release notes |
| 164.312(c) Integrity | GCM authenticated encryption for SSN; DB constraints; append-only log | Implemented in part | `fieldEncryption.js`, migrations |
| 164.312(d) Person or entity authentication | Password policy, bcrypt, login rate limit; TOTP MFA (all users, enforceable per agency) | Passwords: Implemented. MFA: Implemented 2026-10-21, verify in release notes | `passwordValidation.js`, `authRoutes.js` |
| 164.312(e) Transmission security | TLS (Cloud Run, Vercel); Helmet; CORS allow-list | Implemented | `backend/index.js` |
| 164.314 Organizational requirements | Vendor table, BAA gate for customers | Implemented (gate) / Owner action | `BaaGate.jsx`, doc 05 |
| 164.316 Policies and documentation (6-year retention) | This set | Owner action (adopt, keep 6 years) | docs/compliance |

## B. FERPA (34 CFR Part 99), as incorporated by Part C

| Provision | Control | Status | Evidence |
|---|---|---|---|
| 99.3 Definitions, 99.4 Parent rights | Parent-facing procedures in doc 06 | Owner action | doc 06 |
| 99.5 Rights transfer | Not applicable to infants and toddlers [ATTORNEY TO CONFIRM] | n/a | |
| 99.7 Annual notification | Template in doc 06 section 1; tooling | Template: Owner action. Tooling: Planned | doc 06 |
| 99.10 Right to inspect (10 days under Part C) | Per-child record export; request tracker with 10-day due date | Export: Implemented. Tracker: Implemented 2026-10-21 | `patientRecordExportController.js`, release notes |
| 99.11 Fees | No fee for search/retrieval | Owner action (policy) | doc 06 |
| 99.12 Limitations on inspection | Multi-child redaction on exports | Planned | |
| 99.20-.22 Amendment and hearing | Correction-request workflow; Statement of Disagreement and hearing tracking | Correction workflow: Implemented. Statement/hearing tracking: Planned | `correctionRequestController.js`, `add_correction_requests.sql` |
| 99.30 Consent | Consent-gated third-party disclosures; identity verification and e-signature attestation with DOB check | Gate: Implemented. ID verification and attestation: Implemented 2026-10-21 | `utils/recordsConsent.js`, `records_consents` |
| 99.31(a)(1) School-official/contractor exception, reasonable methods | Agency agreement language (doc 06 section 9); caseload scoping and roles | Owner action (execute) / Implemented (access control) | doc 06, legal-drafts/02 |
| 99.32 Record of disclosures | Child-level disclosure log (Record of Access) | Implemented 2026-10-21 | release notes |
| 99.33 Redisclosure limits | Redisclosure notice on every disclosure | Implemented 2026-10-21 | release notes |
| 99.34-.36, .39 Other conditions and exceptions | Not used by product [OWNER TO CONFIRM] | n/a | |
| 99.35-.37 Directory information | No directory information policy | Owner action (adopt) | doc 06 section 6 |
| 99.60-.67 Enforcement | Incident and complaint handling | Owner action | doc 03 |

## C. IDEA Part C confidentiality (34 CFR 303.401-.417)

| Section | Control | Status | Evidence |
|---|---|---|---|
| 303.401-.402 Confidentiality of PII, applicability | Layered policy set; framework determination | Owner action (attorney review of "participating agency" question) | legal-drafts/RESEARCH-BRIEF |
| 303.403 Definitions (participating agency, early intervention records) | Scope statements in doc 06 | Owner action | doc 06 |
| 303.404 Notice to parents | DOH duty; Izaya supplies template and tooling | Template: Owner action. Tooling: Planned | doc 06 section 1 |
| 303.405 Access rights (10 days) | Per-child export; request tracker, 10-day due date | Export: Implemented. Tracker: Implemented 2026-10-21 | export controller |
| 303.406 Record of access | `audit_logs` plus child-level Record of Access | Implemented (base) / Implemented 2026-10-21 (child-level) | `auditLog.js`, release notes |
| 303.407 Records on more than one child | Multi-child redaction | Planned | |
| 303.408 List of types and locations | Doc 06 section 8 and appendix | Owner action | doc 06 |
| 303.409 Fees | No fee policy | Owner action | doc 06 |
| 303.410-.413 Amendment, hearing, result | Correction-request workflow; hearing tracking | Workflow: Implemented. Hearing and Statement of Disagreement: Planned | `correctionRequestController.js` |
| 303.414 Consent before disclosure or use | Consent-gated disclosures, expiry, revocation, recipient match | Implemented | `recordsConsent.js` |
| 303.415 Safeguards (a) protection, (b) one official, (c) training, (d) list of staff with access | Roles and caseload scoping; Designated Confidentiality Official field; access roster; training | Implemented 2026-10-21 (official field, roster); training is Owner action | release notes, doc 04 |
| 303.416 Destruction | Retention and destruction workflow | Planned. Interim manual procedure in doc 06 section 7 | doc 06 |
| 303.417 Enforcement | Complaint and incident procedures | Owner action | doc 03 |

## D. Planned (not built). Be honest in any public statement.

| Item | Owner | Target date |
|---|---|---|
| Application-level encryption of child PII fields (beyond SSN) | [OWNER] | [DATE] |
| Retention and destruction workflow | [OWNER] | [DATE] |
| Statement of Disagreement and hearing tracking | [OWNER] | [DATE] |
| Multi-child redaction on exports | [OWNER] | [DATE] |
| Annual rights notice tooling | [OWNER] | [DATE] |
| SOC 2 (no report exists; do not claim) | [OWNER] | [DATE] |

## E. Open owner and attorney actions

| # | Action | Owner | Done |
|---|---|---|---|
| 1 | Record the Resend vendor decision in writing (no BAA available; child PHI/PII excluded by design; verify with a test send and code review that no child data is in any email) | [OWNER] | [ ] |
| 2 | Place a copy of the signed Google Cloud BAA on file and record which Google services are covered | [OWNER] | [ ] |
| 3 | Attorney review of all drafts, including the federal-vs-NJ "direct control" question (does the EIP agency, the practitioner or DOH exercise control; is the school-official exception usable under Part C) | [ATTORNEY] | [ ] |
| 4 | Appoint the Security Official and the Designated Confidentiality Official (named, in writing) | [OWNER] | [ ] |
| 5 | Schedule and record workforce training dates | [OWNER] | [ ] |
| 6 | Obtain the NJEIS EIP Letter of Agreement and DOH policy on third-party systems | [OWNER] | [ ] |
| 7 | Obtain current N.J.A.C. 8:17 text (2022 readoption) and NJEIS record-retention schedule | [ATTORNEY] | [ ] |
| 8 | Confirm Cloud SQL automated backup, PITR and region settings; run and record a restore test | [OWNER] | [ ] |
| 9 | Verify the 2026-10-21 batch against release notes and update statuses above | [OWNER] | [ ] |
| 10 | Decide public-claim wording with counsel (see doc 05 and legal-drafts/04) | [OWNER/ATTORNEY] | [ ] |

## F. Evidence index (where proof lives)

| Evidence | Location |
|---|---|
| Access trail | `audit_logs` table (tenant DB); `GET /api/audit-logs` (permission `audit_logs`) |
| Consents | `records_consents` table |
| Correction requests | `correction_requests` table |
| Platform admin actions | `platform_audit_logs` (platform DB) [OWNER TO CONFIRM scope] |
| BAA acceptance | `companies.baa_accepted_at` (platform DB) |
| Policies and training | this folder; signed sheets [OWNER TO CONFIRM storage location] |
