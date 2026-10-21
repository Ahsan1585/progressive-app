# Incident Response and Breach Notification Plan

> **DRAFT FOR ATTORNEY REVIEW. Not legal advice.** Does not state that Izaya is compliant or certified.
> **Status:** Draft v0.1, 2026-10-21, not adopted. **Last reviewed:** [DATE] by [REVIEWER]. **Incident Commander (Security Official):** [NAME, PHONE]. **Backup:** [NAME, PHONE]. **Outside counsel:** [NAME, PHONE].

## 1. Roles

| Role | Person | Duties |
|---|---|---|
| Incident Commander | Security Official [NAME] | Declares incident, assigns severity, owns the log and decisions |
| Technical Lead | [NAME] | Containment, forensics, restore |
| Confidentiality Official / Privacy Lead | [NAME] | Notification analysis, agency and parent communications |
| Legal counsel | [NAME] | Breach determination, regulator and DOH notices |
| Communications | [NAME] | Customer and public statements (approved by counsel) |

## 2. What counts as an incident

Any suspected or actual unauthorized access, use, disclosure, alteration, loss or destruction of child records or credentials. Examples: stolen password used, misdirected export, child data found in an email or log, lost phone with a logged-in session, vendor breach, cross-tenant exposure, ransomware.

## 3. Severity levels

| Level | Definition | Response start | Examples |
|---|---|---|---|
| SEV1 Critical | Confirmed or likely exposure of child records, multiple children or agencies, active attacker | Immediate, within 1 hour | Database access by attacker, cross-tenant leak |
| SEV2 High | Confirmed exposure of a single child or one account compromise with access to records | Within 4 hours | Stolen credential used; disclosure to wrong recipient |
| SEV3 Medium | Possible exposure, policy violation, contained | Within 1 business day | Lost phone, session still locked; child name found in an email log |
| SEV4 Low | Security event with no data exposure | Within 3 business days | Failed login spike blocked by rate limit |

## 4. Clocks and legal frameworks [ATTORNEY TO CONFIRM ALL]

| Framework | Trigger | Clock | Notify |
|---|---|---|---|
| Customer contract (data agreement) | Confirmed unauthorized access to records | Notify the agency without unreasonable delay, target [XX] business days (placeholder in `legal-drafts/02` C.2) | Agency Confidentiality Official / Admin |
| HIPAA Breach Notification Rule (45 CFR 164.400-414), where HIPAA applies (non-NJEIS PHI; Izaya as business associate) | Breach of unsecured PHI | Business associate notifies covered entity without unreasonable delay and no later than 60 days from discovery (contract may be shorter). Covered entity notifies individuals within 60 days; HHS: within 60 days if 500 or more, annual log if fewer; media if more than 500 in a state | Covered entity |
| FERPA / Part C (34 CFR Part 99, 303.401-.417) | Unauthorized disclosure of early intervention records | No fixed federal clock. Participating agency has safeguard duties (303.415) and exposure to enforcement (303.417; 99.67). Notify agency promptly; agency decides on notice to DOH and parents. NJ contract terms may add duties (N.J.A.C. 8:17 Subchapter 12; EIP Letter of Agreement) [OWNER TO CONFIRM] | Agency, then DOH via agency |
| NJ breach statute (N.J.S.A. 56:8-161 to -166) | Unauthorized access to unencrypted or key-compromised personal information (name plus SSN, driver's license, account number with access code, or username plus password). Izaya holds an SSN field (encrypted at the application level) and login credentials | Business that compiles or maintains data for another must notify that business immediately following discovery; the owner/licensee must notify affected NJ residents in the most expedient time possible without unreasonable delay. Before disclosing to any NJ customer, the business must report the breach to the Division of State Police in the Department of Law and Public Safety. | State Police first, then customers |
| Other state laws | Residents of other states in the data | Varies | Counsel |

Encrypted data is generally outside breach definitions only if the key was not also compromised. Counsel decides.

## 5. Runbook

**Step 0. Detect and report.** Anyone who suspects an incident messages the Security Official immediately (no PHI in the message). Sources: staff report, audit log anomaly, vendor notice, customer report, alert.

**Step 1. Triage (first hour).** Open an incident record: ID, time discovered (this starts the clock), reporter, summary, severity. Preserve evidence before changing anything.

**Step 2. Contain.**
- Disable affected accounts (deactivating a practitioner revokes access on the next request).
- Rotate exposed secrets: `JWT_SECRET` (invalidates all tokens), DB credentials, API keys, `PLATFORM_ADMIN_KEY`. Changing `FIELD_ENCRYPTION_KEY` requires a re-encryption plan first; never discard the old key.
- Revoke Stripe/Resend/GCS keys as relevant. Revoke signed URLs by moving or deleting the object.
- If a bad deploy is the cause, roll back the Cloud Run revision.
- Suspend a tenant (`companies.status = 'suspended'`) if needed.

**Step 3. Investigate (forensics).**
1. Query the tenant `audit_logs` (columns: actor_id, actor_email, actor_role, action, resource_type, resource_id, details, ip_address, created_at; indexes on time, actor, resource). Build a timeline for the affected actor, child, or time window.
2. Check `login_failed`, `login_success`, `login_blocked_deactivated`, `patient_record_export`, `patients_bulk_view`, `sevf_emailed_to_agency`, `sevf_disclosure_blocked_no_consent`, `records_consent_*` and `njeis_pdf_generate` actions. Impersonation shows `viaImpersonation` in details.
3. Query `platform_audit_logs` for platform admin activity.
4. Use the child-level disclosure log / Record of Access (Implemented 2026-10-21) to list every recipient per child.
5. Pull Cloud Run, Cloud SQL, GCS and Vercel logs; Resend delivery logs (webhook records) for any email.
6. Note log gaps: before the 2026-10-21 batch, audit logging was fire-and-forget and did not cover every action, so absence of a row is not proof of absence of access. Say so in findings.
7. Do not modify or delete `audit_logs` rows.

**Step 4. Assess.** With counsel, determine: which framework(s) apply; which children, agencies and data elements; whether data was encrypted and keys safe; probability of compromise (HIPAA four-factor risk assessment: nature of data, who received it, whether acquired/viewed, extent of mitigation). Record the decision and reasoning even if the conclusion is "not a breach".

**Step 5. Notify.**
1. Agency (customer) first, using the template below, by phone then written notice through a channel that does not carry child data.
2. NJ State Police report if NJ personal information is involved, before notifying NJ customers.
3. Agency notifies DOH, parents, HHS and others as its obligations require; Izaya supplies facts and a draft letter. Where Izaya is directly obligated, counsel directs.
4. Regulators and media only via counsel.

**Step 6. Recover and remediate.** Restore from backup if needed, fix root cause, add tests, update risk register (doc 01).

**Step 7. Close.** Post-incident review within 14 days: timeline, cause, what worked, actions with owners and dates. Retain all documents 6 years.

## 6. Notice template (to agency)

> **Subject: Security incident notice from Izaya EIS [INCIDENT ID]**
> (Do not include any child names or identifiers in this message.)
>
> Dear [Agency Confidentiality Official],
>
> On [DATE] we discovered that [short description of what happened, in plain language]. We believe it began on [DATE] and [is/is not] ongoing.
>
> **What information was involved:** [types of data, such as session logs, SEVF forms, SSN field encrypted/not accessed]. Approximately [NUMBER] children from your agency may be affected. A list is available through [secure channel].
>
> **What we have done:** [containment, access disabled, credentials rotated, investigation under way].
>
> **What we recommend you do:** [review the Record of Access for the affected children; assess your own notice duties to parents and DOH; reset passwords for the following users].
>
> **What we will do next:** We will update you by [DATE/TIME] and provide logs and a final report.
>
> Contact: [NAME, TITLE, PHONE, EMAIL]. [Optional: Izaya will support your notice to families and DOH.]

## 7. Parent or individual notice (draft, agency-issued, counsel to approve)

State: what happened; what information; what the agency/Izaya did; what the family can do; whom to contact; how to learn more. Plain language, in the family's native language where required (303.7). [ATTORNEY TO CONFIRM content required under NJ law and HIPAA 164.404.]

## 8. Exercises and records

Tabletop exercise at least annually [DATE]. Keep the incident log, assessment, notices, and evidence for 6 years.
