# FERPA and IDEA Part C Procedures

> **DRAFT FOR ATTORNEY REVIEW. Not legal advice.** Does not state that Izaya is compliant or certified.
> **Status:** Draft v0.1, 2026-10-21, not adopted. **Last reviewed:** [DATE] by [REVIEWER]. **Designated Confidentiality Official:** [NAME].
> Who owns what: the participating agency (EIP agency or practitioner) and DOH carry the parent-facing duties. Izaya supplies tooling, templates and contract terms. Templates here are for the agency to adapt. Current N.J.A.C. 8:17 and the EIP Letter of Agreement must be checked before use [ATTORNEY TO CONFIRM].
> Tooling notes: "Implemented 2026-10-21, verify in release notes" means built that day.

## 1. Annual rights notice (template)

Tooling for distributing and tracking this notice is Planned. Until then the agency sends it manually and keeps proof.

> **Notice of Your Rights Regarding Your Child's Early Intervention Records**
> [AGENCY NAME] provides early intervention services under Part C of the Individuals with Disabilities Education Act and New Jersey's Early Intervention System. We keep records about your child. These records are protected by IDEA Part C (34 CFR 303.400-.417) and the Family Educational Rights and Privacy Act (34 CFR Part 99).
> You have the right to:
> 1. **Inspect and review** your child's early intervention records. We will respond without unnecessary delay and within 10 calendar days of your request, and before any meeting or hearing about your child. You may ask us to explain the records.
> 2. **Receive copies.** There is no charge to search for or retrieve records. [Copying fee, if any, only if it does not prevent you from exercising your rights; copies of evaluations and IFSPs are free.] [ATTORNEY TO CONFIRM]
> 3. **Ask us to correct** information you believe is inaccurate, misleading or violates your child's privacy, and have a hearing if we refuse. You may add a statement of disagreement.
> 4. **Give or refuse consent** before we share personally identifiable information outside the early intervention system, except where the law allows it without consent. You may revoke consent in writing.
> 5. **See a record of who has accessed** your child's records and to whom they were disclosed.
> 6. **Ask for destruction** of information that is no longer needed. We may keep a limited permanent record (name, birth date, parent contact information, service dates and providers, and exit data).
> 7. **File a complaint** with [NJ DOH contact] and with the U.S. Department of Education, Student Privacy Policy Office, 400 Maryland Avenue SW, Washington, DC 20202.
> We do not release directory information. Staff with access to your child's records are listed at [LOCATION/REQUEST]. For questions contact [NAME, PHONE, EMAIL]. Available in your native language on request.

## 2. Parent inspection procedure (10 calendar days, no fee)

| Step | Action | Who | Tool |
|---|---|---|---|
| 1 | Receive request (phone, email, mail, in person; oral requests count). Log it with date received. | Any staff, then Confidentiality Official | Records-inspection request tracker, 10-day due date (Implemented 2026-10-21) |
| 2 | Verify identity of requester and confirm they are the child's parent/guardian. Record the method used. | Confidentiality Official | Identity verification recorded on request (Implemented 2026-10-21) |
| 3 | Gather records: use per-child record export. Check for other children's information in the records; redact manually until multi-child redaction is built (Planned). | Staff with `patient_record_rights` | `patientRecordExportController.js` |
| 4 | Deliver within 10 calendar days of request; sooner before any IFSP meeting or hearing. Offer an explanation. Deliver by expiring secure link or in person, not by attaching to ordinary email. | Confidentiality Official | |
| 5 | Charge no fee for search and retrieval. | | |
| 6 | Record the access in the Record of Access, close the request. | | Child-level Record of Access (Implemented 2026-10-21) |
| 7 | If the agency cannot meet 10 days, document why and notify the parent in writing. | | |

## 3. Amendment and hearing procedure

1. Parent submits a correction request. Staff create it in the correction-request workflow (`correction_requests`; `correctionRequestController.js`). Implemented.
2. Decision within [10 / 30] days [ATTORNEY TO CONFIRM current NJ time limit; older N.J.A.C. text says 30]. The record's author and the Confidentiality Official review.
3. If accepted: amend the record, keep history, notify the parent in writing. Session log edits remain visible in the audit trail.
4. If refused: written notice stating the reason and the right to a hearing.
5. Hearing (34 CFR 303.411-.413, 99.22): held within a reasonable time; reasonable notice of date, place, time; conducted by an official with no direct interest in the outcome; parent may bring others, including an attorney, at own expense; decision in writing within a reasonable period, based only on hearing evidence, with reasons.
6. If the decision is against the parent, the parent may place a **Statement of Disagreement** in the record, which must be kept with and disclosed with the contested portion.
7. Tracking for hearings and Statements of Disagreement is Planned. Interim: record in a manual log [OWNER].

## 4. Written consent procedure with identity verification

1. Consent is required before disclosing personally identifiable information outside the Part C system, except where an exception applies (303.414; 34 CFR 99.30-.31).
2. Valid consent is written, signed and dated, in the parent's native language, and states: the records, the purpose, the recipient (named), that it is voluntary and revocable, and an expiry date (303.7 "consent").
3. Staff verify the signer's identity (and parent relationship) before accepting consent and record how. Identity verification and e-signature attestation with DOB verification: Implemented 2026-10-21, verify in release notes.
4. The system enforces: recipient name and email must match; unexpired and unrevoked; record types must cover what is sent (`utils/recordsConsent.js`). Blocked attempts are audit-logged (`sevf_disclosure_blocked_no_consent`). Implemented.
5. Revocation takes effect immediately for future disclosures (`records_consent_revoked`).
6. Consent must not be a condition of receiving services [ATTORNEY TO CONFIRM against 303.414(c), 303.420].
7. Consent for billing disclosures to Medicaid or public benefits: separate consent per 303.414 and 303.520 [ATTORNEY TO CONFIRM how NJ handles].

## 5. Redisclosure rule

Each disclosure carries a notice: "This information is disclosed from the early intervention records of [CHILD'S AGENCY]. It is protected by IDEA Part C and FERPA. You may not disclose it to any other party without prior written consent of the parent, except as the law permits (34 CFR 99.33). Use it only for the purpose for which it was disclosed." Attached to every disclosure and recorded in the child-level disclosure log (Implemented 2026-10-21). A recipient who rediscloses improperly may be barred from access for at least 5 years (34 CFR 99.67).

## 6. Directory information policy

[AGENCY NAME] and Izaya designate **no** directory information. No child or family information is released as directory information. Marketing, social media and testimonials never use child data. Platform tooling must not publish child information. Statements to the press or public are made only with written parent consent.

## 7. Retention and destruction schedule

Automated retention and destruction workflow is **Planned**. Interim procedure: the agency requests destruction in writing; Izaya support deletes per the data agreement and records it; deletion is logged.

| Record class | Retention period (placeholder) | Notes |
|---|---|---|
| Session logs / assessments | [5-7 YEARS] [OWNER/ATTORNEY TO CONFIRM] | Align with NJEIS, Medicaid and audit retention schedules |
| SEVFs and invoices | [5-7 YEARS] [OWNER/ATTORNEY TO CONFIRM] | Agency keeps original parent-verified SEVFs |
| Consents, requests, disclosure log, correction requests | [5-7 YEARS or life of record] [OWNER/ATTORNEY TO CONFIRM] | Access and disclosure records must be kept as long as the records are kept |
| `audit_logs` | At least 6 years [ATTORNEY TO CONFIRM] | HIPAA documentation rule |
| Account data for departed users | [x years] [OWNER TO DEFINE] | |

Destruction rules:
1. Parents may request destruction once the information is no longer needed to provide services or for audit, evaluation and legal retention (303.416). Inform parents when information is no longer needed; they decide whether to destroy.
2. Destroy across the database, object storage and backups (backups expire on their own cycle; document that cycle) [OWNER TO CONFIRM].
3. **Permanent record** that may be kept without time limit: child's name, date of birth, parent contact information, names of service coordinators and EIS providers, and exit data (year and age at exit, programs entered) (303.416). No session notes or other content.
4. On account termination Izaya returns or destroys records as the agency directs (`legal-drafts/01` 10.3, `legal-drafts/02` A.6).

## 8. List of types and locations of early intervention records (303.408)

| Type | System | Location |
|---|---|---|
| Child and family information, SSN (encrypted field) | Izaya tenant database | Google Cloud SQL, region [OWNER TO CONFIRM] |
| Session logs, signatures, drafts | Izaya tenant database | Google Cloud SQL |
| SEVFs, invoices, compliance documents | Izaya object storage | Google Cloud Storage, tenant-prefixed |
| Consents, correction requests, requests, disclosure log, audit trail | Izaya tenant database | Google Cloud SQL |
| State records | EIMS | NJ DOH / PCG |
| Original parent-verified SEVFs | Agency files | [AGENCY] |

## 9. Outsourcing exception language the agency agreement must contain (34 CFR 99.31(a)(1)(i)(B))

Suggested clause for `legal-drafts/02` Part A, for attorney review:

> **School-official / contractor designation.** [AGENCY] designates Izaya Consulting LLC as a contractor to which [AGENCY] has outsourced institutional services or functions (hosting and processing of early intervention records for session logging, billing form generation and parent signature collection). Izaya (1) performs a service or function for which [AGENCY] would otherwise use its own employees; (2) is under the direct control of [AGENCY] with respect to the use and maintenance of early intervention records, including that Izaya will act only on [AGENCY]'s documented instructions, will make records available for [AGENCY]'s inspection, audit and parent-rights obligations, and will return or destroy records at [AGENCY]'s direction; (3) will use personally identifiable information only for the purposes for which the disclosure was made and will not redisclose it except as 34 CFR 99.33(a) permits; (4) will use reasonable methods to ensure only those with a legitimate need access records, consistent with 34 CFR 99.31(a)(1)(ii); (5) will not use the information for marketing, sale, or unrelated product development, and will not combine it with other data; (6) will notify [AGENCY] of any unauthorized access or disclosure within [XX] business days; (7) will support [AGENCY]'s parent access (10 days), record-of-access, amendment and destruction duties under 34 CFR 303.405-.416; and (8) will flow these terms to any subprocessor. [AGENCY] remains responsible for the notice (303.404), access, amendment and consent procedures under Part C.

Notes for counsel: (a) ED's 2016 FAQ says the "school official" exception is "not as applicable" in Part C, while NJ's Parent Rights Handbook relies on a contractor exception; (b) who exercises direct control (EIP agency, practitioner, DOH); (c) PTAC cautions that terms the vendor can change without notice undermine direct control, so the amendment clause in the ToS should require notice and agency consent.
