# Adoption of HHS 405(d) HICP as Recognized Security Practices

> **DRAFT FOR ATTORNEY REVIEW. Not legal advice.** Does not state that Izaya is compliant or certified.
> **Status:** Draft v0.1, 2026-10-21, NOT yet adopted. **Last reviewed:** [DATE] by [REVIEWER]. **Adopted by:** [OWNER NAME, TITLE] on [DATE].

## 1. Adoption statement (to sign once true)

Izaya Consulting LLC adopts the Health Industry Cybersecurity Practices (HICP): Managing Threats and Protecting Patients, 405(d) program, small-practice volume, as the recognized security practices framework for the Izaya EIS platform. Izaya will implement the ten practices to the extent appropriate for its size and risk, document the implementation, and review it at least annually. Adoption is a commitment to a plan. It is not a claim that every practice is in place today. Gaps are listed below with owners and dates.

Signed: ____________ [OWNER]  Date: ________

**Safe-harbor note.** Under the HITECH amendment (Pub. L. 116-321, 2021), HHS must consider whether recognized security practices were in place for the previous 12 months when it determines fines or audit outcomes. The 12 months only start counting when the practices are actually in place and documented. Adopting this page does not start the clock. The clock for each practice starts on the "in place since" date recorded in section 3, and that date needs evidence. This is a mitigation factor, not immunity, and does not apply to FERPA/Part C enforcement [ATTORNEY TO CONFIRM].

## 2. The ten practices mapped to Izaya

| # | HICP practice | Izaya control today | Gap | Owner / date |
|---|---|---|---|---|
| 1 | Email protection systems | Transactional email only via Resend; no child data in email (verify 2026-10-21 fixes); sender domain configuration [OWNER TO CONFIRM SPF/DKIM/DMARC]; phishing training planned | Confirm DMARC enforcement; workforce mailbox protection [OWNER TO CONFIRM provider] | [OWNER] / [DATE] |
| 2 | Endpoint protection systems | Cloud-hosted app; no PHI stored on devices by policy; device policy in doc 02 section 7 | Workforce laptop controls (disk encryption, EDR, auto-updates) not verified | [OWNER] / [DATE] |
| 3 | Access management | Unique IDs, roles/permissions, caseload scoping, per-request revocation, TOTP MFA (Implemented 2026-10-21), idle timeouts, access roster, audit log | MFA enforcement rollout; quarterly access reviews not yet recorded | [OWNER] / [DATE] |
| 4 | Data protection and loss prevention | TLS, Cloud SQL encryption at rest, SSN AES-256-GCM, tenant isolation, disclosure consent gate, redisclosure notices, signed URLs, no-store on drafts | App-level encryption of other child PII (Planned); billing PDF no-store; DLP on outbound email via technical test | [OWNER] / [DATE] |
| 5 | Asset management | Asset inventory in doc 01 | Keep inventory current; dependency inventory/SBOM not produced | [OWNER] / [DATE] |
| 6 | Network management | Managed Cloud Run/Cloud SQL/Vercel; Helmet; CORS allow-list; rate limits | Confirm Cloud SQL private networking and authorized networks [OWNER TO CONFIRM]; WAF/DoS posture | [OWNER] / [DATE] |
| 7 | Vulnerability management | Lockfiles; managed platforms patching | No scheduled dependency/container scanning or pen test; set cadence | [OWNER] / [DATE] |
| 8 | Security operations center and incident response | Append-only audit log; incident plan (doc 03) | No 24x7 monitoring or alerting [OWNER TO CONFIRM]; tabletop not held | [OWNER] / [DATE] |
| 9 | Network connected medical devices | Not applicable (software only) | None | n/a |
| 10 | Cybersecurity oversight and governance | Security Official and Confidentiality Official to be appointed; policy set; risk register | Appointments, annual review, board/owner sign-off | [OWNER] / [DATE] |

## 3. 12-month evidence checklist

Keep evidence in a dated folder per practice. "In place since" is the date the control was verifiably operating.

| Evidence | Practice | In place since | Location |
|---|---|---|---|
| Signed adoption statement | 10 | [DATE] | [LOCATION] |
| Appointment letters (Security Official, Confidentiality Official) | 10 | [DATE] | |
| Signed risk analysis and register, annual re-run | 10, 5 | [DATE] | doc 01 |
| MFA enforcement settings screenshot per agency and for staff | 3 | [DATE] | |
| Quarterly access review records | 3 | [DATE] | |
| Monthly audit-log review records | 3, 8 | [DATE] | |
| Release notes verifying 2026-10-21 controls | 3, 4 | [DATE] | |
| Training sign-off sheets | 1, 10 | [DATE] | doc 04 |
| Phishing exercise results | 1 | [DATE] | |
| Vendor decisions (Resend) and BAA copies (Google) | 4, 10 | [DATE] | doc 05 |
| Email test proving no child data in outbound mail | 1, 4 | [DATE] | CI test |
| Backup settings and restore test results | 4, 8 | [DATE] | |
| Dependency and container scan reports, monthly | 7 | [DATE] | |
| Penetration test report (annual) | 7 | [DATE] | |
| Endpoint controls attestation for workforce devices | 2 | [DATE] | |
| Incident tabletop record | 8 | [DATE] | doc 03 |
| Annual review minutes | 10 | [DATE] | |

Do not describe a practice as "in place for 12 months" publicly until each date is at least 12 months old and the evidence exists.
