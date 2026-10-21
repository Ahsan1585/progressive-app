# Workforce Training Outline

> **DRAFT FOR ATTORNEY REVIEW. Not legal advice.** Does not state that Izaya is compliant or certified.
> **Status:** Draft v0.1, 2026-10-21, not adopted. **Last reviewed:** [DATE] by [REVIEWER]. **Training owner:** [NAME].

Audience: all Izaya workforce (employees, contractors, platform admins). Agencies are responsible for training their own staff and practitioners (34 CFR 303.415(c)); Izaya may offer these modules to them. Deliver at onboarding, annually, and after any material policy change or incident. Total about 2 hours. Target first delivery date: [DATE].

## Module 1. HIPAA basics (30 min)

1. What PHI is, and why NJEIS early intervention records are likely governed by Part C and FERPA instead (and where HIPAA still applies: non-NJEIS clients, billing transactions, mixed records).
2. Minimum necessary; need-to-know; caseload scoping in the product.
3. Security Rule in plain terms: access, audit, integrity, transmission security, authentication.
4. Business associates and why Resend must never receive child data.
5. Breach definition and the 60-day clock (see doc 03).
6. Sanctions policy (doc 02 section 9).

## Module 2. FERPA essentials (25 min)

1. Education records = early intervention records under Part C; parent rights (inspect, amend, consent, complain).
2. Consent before disclosure; the exceptions; identity verification of the person giving consent or requesting records.
3. Redisclosure rule and the notice attached to every disclosure.
4. Record of disclosures (child-level log).
5. No directory information release.

## Module 3. IDEA Part C confidentiality (30 min)

1. Who is a participating agency; Izaya's role as contractor under agency direct control [pending attorney].
2. Parent notice (303.404) and the annual notice.
3. Access within 10 calendar days; no fee for search and retrieval; using the request tracker.
4. Amendment requests, Statement of Disagreement, hearings (workflow and Planned tooling).
5. Safeguards (303.415): one responsible official, training, list of staff with access.
6. Destruction and retention (303.416); permanent minimal record.
7. When to escalate to the Confidentiality Official.

## Module 4. Phishing, passwords and MFA (20 min)

1. Recognizing phishing: urgent tone, mismatched sender, unexpected links, requests to "verify" credentials.
2. Izaya emails contain links and non-child content only; anyone asking for child data by email is suspicious.
3. Set up and use TOTP MFA; never share codes; recovery process.
4. Password hygiene; password manager; no reuse.
5. Report suspicious messages immediately to the Security Official.
6. Lock screens; idle timeout behavior (15 min app lock, 30 min server).

## Module 5. Handling child data day to day (15 min)

1. No child data on personal devices outside the app, no screenshots, no personal email, text or chat.
2. Downloaded PDFs: where to save, when to delete.
3. Never use real child data for testing or demos.
4. Lost device and incident reporting (doc 03, report within 24 hours).
5. Support work: access customer data only with a request, and expect it to be logged.

## Assessment

10-question quiz, 80% to pass; retake until passed. Keep scores.

## Sign-off sheet template

| Name | Role | Module(s) | Date completed | Score | Trainer | Signature |
|---|---|---|---|---|---|---|
| [NAME] | [ROLE] | 1-5 | [DATE] | [ ]% | [NAME] | [ ] |

Attestation text: "I have completed the training listed above. I understand the Izaya security and confidentiality policies, I will follow them, and I understand that violations may lead to sanctions up to termination. I will report suspected incidents immediately."

Employee signature: ____________ Date: ________  Security Official signature: ____________ Date: ________

Retain sign-off sheets and materials for at least 6 years. Training log summary lives with the evidence index in `00-README.md`.
