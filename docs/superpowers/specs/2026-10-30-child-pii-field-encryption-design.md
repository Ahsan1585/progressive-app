# Child PII Field-Level Encryption — Design

**Why:** The last open gap in FERPA/IDEA Part C pillar 6 (Technical Security).
Today only `practitioners.ssn` is encrypted at the application level
(`backend/src/utils/fieldEncryption.js`, AES-256-GCM). Every other PII
column — child name, DOB, clinical session notes — relies solely on
Cloud SQL's default at-rest disk encryption. This closes that gap for
the two field classes the owner approved: child identity (name + DOB)
and clinical narrative (`session_notes`).

**Threat model this defends against:** a leaked/misdelivered backup or
snapshot, a compromised DB credential, or overprivileged/insider DB
access that bypasses the app's HTTP-layer RBAC and caseload scoping.
It does **not** protect against a compromised application session —
the app decrypts on every authenticated read, same tradeoff already
accepted for SSN.

## Scope (confirmed from code, not assumed)

**Encrypt:**
- `patients.first_name`, `patients.last_name`, `patients.middle_name`, `patients.dob`
- `assessments.patient_first_name`, `assessments.patient_last_name`, `assessments.patient_dob` (session-time snapshot copies of the same identity)
- `assessments.session_notes` (the actual free-text clinical narrative)

**Explicitly NOT in scope** (checked against real call sites, not guessed):
- `assessments.form_data` (jsonb) — holds billing `custom_fields` (service category codes), not clinical narrative. `dropdownOptionsController.js` runs a live SQL query into it (`form_data->'custom_fields'->>$2 = $1`); encrypting the column would break that query the same way encrypting names breaks `ORDER BY`. Not PII in the FERPA sense — it's a billing code.
- `assessment_notes.note` — an internal practitioner/billing-specialist comment thread about a billing rejection, not clinical content about the child.
- Parent contact (`parent_name`, `parent_email`) and signatures — owner deferred these; lower marginal benefit, rarely searched/sorted today, revisit later if desired.

## Two mechanisms, matched to how each field is actually queried

### 1. `session_notes` — plain encrypt-on-write / decrypt-on-read

No production code ever filters or sorts on `session_notes` in SQL. The
only `LIKE` query against it (`testDataController.js`, 3 call sites) is
test-data tooling matching its own `[GENSEPT26]` sentinel tag — not real
search. This column needs nothing beyond the existing SSN pattern:
`encryptField()`/`decryptField()` wrapped around every read/write site.

**Test tooling fix:** write the `[GENSEPT26]` tag as an *unencrypted
prefix marker stored in a separate lightweight lookup*, or — simpler and
sufficient — change those 3 queries to `SELECT id, session_notes FROM
assessments` unfiltered (scoped by the existing date/service_date
filters already in those queries) and do the tag match in Node after
decrypting. These are one-off admin scripts operating on small result
sets; this costs nothing in production.

### 2. Name + DOB columns — blind-index companion columns

Six+ production call sites do `ORDER BY ... last_name`/`first_name` or
`ILIKE` search against these columns (billing exports, company roster,
dashboard, patient directory, Master Reports' audit filter, messaging
list). Encrypting the plaintext column breaks all of them unless
something SQL-queryable replaces it.

**Schema addition** — for each encrypted column, add one companion
index column:
- `patients.first_name_idx`, `patients.last_name_idx` (text, HMAC-SHA256 hex digest of the lowercased, trimmed plaintext, using a key **separate from** `FIELD_ENCRYPTION_KEY` — call it `FIELD_INDEX_KEY`)
- Same pair on `assessments.patient_first_name_idx` / `patient_last_name_idx`
- No index column for DOB — it's never searched/filtered by substring in the call sites found, only ever read/displayed or compared for exact birthday-reminder-type logic, which can decrypt-and-compare in app code on the (always small) result set it already operates on.

**Why a second key:** an HMAC blind index is deterministic — the same
plaintext always produces the same digest, which is what makes
exact-match lookup possible. That determinism is also a (small) leak:
two rows with the same first name are visibly linkable via the index
even without decrypting. Using a key independent from the one that
produces IV-randomized AES-GCM ciphertext means compromising one
doesn't help attack the other, and it keeps the index purely a lookup
aid, never reversible back to plaintext on its own.

**How each call site is rewritten:**
- **Exact-match lookups** (practitioner-name lookup in billing, dropdown autocomplete use): compute HMAC of the lowercased input client-side-equivalent (in the controller) and `WHERE first_name_idx = $1`.
- **Prefix/substring `ILIKE` search** (Master Reports' free-text patient search box, 4 call sites in `reportController.js`): a blind index can't support arbitrary substring match without leaking much more structure (n-gram indexes), which is disproportionate here. These call sites are already scoped by date range and paginated. Rewrite to: fetch the date/status-scoped candidate rows without the name filter, decrypt `patient_first_name`/`patient_last_name` in Node, filter in application code, then paginate. Acceptable because Master Reports queries are bounded by month/company, not the whole table.
- **`ORDER BY last_name`/`first_name`** (company roster, dashboard, patient directory, messaging list — all small, bounded result sets: one agency's roster or one practitioner's caseload): drop the SQL `ORDER BY` on the encrypted column, order by `id` or `created_at` at the SQL layer instead (stable, deterministic pagination), decrypt the page, then `.sort()` in Node before sending the response. None of these call sites return more than a few hundred rows.

## Migration & backfill (follows the existing SSN pattern exactly)

1. `backend/db/migrations/add_child_pii_encryption.sql` — per-tenant, manually applied like `widen_ssn_column_for_encryption.sql`:
   - Widen `patients.first_name`/`last_name`/`middle_name` if needed (ciphertext is longer than plaintext; `text` columns already have no length cap here, so likely a no-op check, not a real widen)
   - Change `patients.dob` and `assessments.patient_dob` from `date` to `text` (a `date` column cannot hold a ciphertext string — this is a real, non-reversible-without-care type change)
   - Add `first_name_idx`, `last_name_idx` columns (text, nullable, indexed with a plain btree index for fast exact-match `WHERE` lookups) to both `patients` and `assessments`
2. `backend/scripts/encryptChildPii.js` — one-off backfill, run manually per tenant DB, same safety properties as `encryptExistingSsns.js`: idempotent via the `v1:` prefix check, requires `FIELD_ENCRYPTION_KEY` and `FIELD_INDEX_KEY` to match what's configured in production, skips already-encrypted rows so it's safe to re-run.
3. New Cloud Run secret `FIELD_INDEX_KEY` (32 random bytes, same generation command as `FIELD_ENCRYPTION_KEY`), backed up the same way per the existing key-backup note in `fieldEncryption.js` and `docs/compliance/01-hipaa-risk-analysis.md`'s T9 risk entry.

## `fieldEncryption.js` additions

- `encryptField`/`decryptField` stay as-is (already generic, not SSN-specific despite the comment header — comment gets updated to reflect broader use).
- New `hmacIndex(plaintext)` — lowercases, trims, HMACs with `FIELD_INDEX_KEY`, returns hex digest. Returns `null` for empty/null input (consistent with `encryptField`'s existing null-passthrough behavior) so an empty name doesn't collide with every other empty name under one shared digest — actually it would, since HMAC of `''` is deterministic too; the spec will special-case: `hmacIndex` returns `null` directly for empty/null without hashing, and index-column `WHERE` clauses that take user input treat an empty search term as "no filter" rather than issuing a `WHERE col IS NULL`-style match on every blank-named row. (Edge case worth a dedicated test.)

## Write-path changes

Every `INSERT`/`UPDATE` into `patients` or `assessments` that sets
name/DOB/session_notes must now also compute and set the matching
`_idx` column(s). This touches the practitioner invite/create flow,
patient create/edit (`patientController.js`), assessment creation
(`createAssessment.js`), and the date-change/resign flow
(`dateChangeResign.js`) — each gets one extra `hmacIndex()` call per
indexed field, mirrored alongside the existing `encryptField()` call.

## DOB-as-identity-verification — a read path that compares, not just displays

Four controllers (`consentManageController.js`, `consentSigningController.js`,
`telepracticeSignatureController.js`, `billingController.js`) use the
child's DOB as a shared-secret identity check: a parent types in the
child's birthdate on a public consent/e-signature link, and the
controller compares it against the stored `patients.dob`/
`assessments.patient_dob` to prove the requester actually knows it
before granting access. These queries currently `SELECT` the plaintext
column directly and compare the parent's input (converted via
`dobToIso()`, which expects a JS `Date` object from the driver) against
it with strict equality.

Once `dob` is ciphertext, this breaks silently and badly: the SQL read
returns an encrypted string instead of a `Date`, `dobToIso()`'s
`instanceof Date` check fails, and the comparison never matches —
locking every parent out of consent management, not just failing loud.
Every one of these 4 call sites must call `decryptField()` on the
stored value before comparing, not just before display. This is a
correctness-critical change, not a display nicety — it gets its own
explicit task and test in the implementation plan, not folded silently
into "add decryptField calls to read paths."

**A second, distinct comparison consumer — EIMS compliance matching.**
`billingController.js:2253-2261` compares `session.patient_dob` against
a DOB value parsed from an uploaded NJEIS EIMS compliance file
(`value`, from external state data, always plaintext) via strict string
equality, to flag sessions where the agency's record disagrees with the
state's. Same failure mode: once `patient_dob` is ciphertext, this
comparison breaks and every session falsely flags as a DOB mismatch,
silently corrupting the compliance-flagging feature rather than
erroring. This read path also needs `decryptField()` before the
comparison, and gets its own test (an EIMS upload whose DOB genuinely
matches the encrypted stored value must NOT flag as a mismatch).

## A third, higher-stakes comparison/parsing consumer — the official NJEIS state forms

A second review pass, searching the whole backend (not just controllers)
for `dob`/`patient_dob`, surfaced two files the first pass missed:
`backend/src/utils/njeisFormFiller.js` and
`backend/src/utils/njeisGenerator.js` — the code that fills the actual
NJEIS/SEVF forms filed with the state.

- `njeisFormFiller.js:44-45` does `pData.patient_dob.split('-')` to pull
  year/month/day apart for the state PDF form fields. Given ciphertext
  instead of `"YYYY-MM-DD"`, this either throws or — far worse — produces
  a `.split('-')` result on the ciphertext string that silently writes
  wrong digits into a legally-filed state compliance document. This is
  the single highest-stakes site in the whole change: it's the one place
  "doesn't break functionality" and "compliance with state" are the same
  requirement, not two separate ones.
- `njeisGenerator.js:154` calls `formatShortDate(child.dob)`, a function
  that also expects a parseable date string, to fill the DOB field on
  generated NJEIS forms.

**Why this wasn't obvious from the column type alone:** `tenantPoolRegistry.js:4-8`
sets a **global pg type parser** —
`types.setTypeParser(types.builtins.DATE, (val) => val)` — specifically
so every `date` column across the whole app, on every tenant pool,
comes back as a raw `"YYYY-MM-DD"` string rather than a JS `Date`, with
a comment explicitly noting this is *because* PDF/report generation
code does string ops directly on these values. This is a standing,
deliberate, app-wide convention — not an isolated quirk of one
controller — which means the `date` → `text` type change at the SQL
level is less disruptive than it first appeared (the app already
treated it as a string everywhere), but it also means **every consumer
of `patient_dob`/`dob` that does string parsing, not just the 4
identity-verification controllers and the EIMS-matching site already
listed, needs its read path audited and given a `decryptField()` call
before use.** `njeisFormFiller.js` and `njeisGenerator.js` are added to
that list; both need a dedicated test asserting a real NJEIS/SEVF form
generated from an encrypted-at-rest patient DOB renders the correct,
decrypted date on the output PDF — not a crash, and not silently wrong
digits.

**Process note:** this finding came from a second, broader grep pass
across the entire `backend/src` tree (146 hits) rather than the
controller-scoped pass used for the first version of this spec.

**That full-repo pass is done** (not deferred). Every non-test file
referencing `patient_dob`, `patient_first_name`, `patient_last_name`, or
`session_notes` was checked:

- `njeisFormFiller.js`, `njeisGenerator.js` — string-parsing consumers, covered above, need explicit decrypt-before-parse and a dedicated test.
- `consentManageController.js`, `consentSigningController.js`, `telepracticeSignatureController.js`, `billingController.js` — comparison consumers (identity verification, EIMS matching), covered above with their own tests.
- `inspectionRequestController.js`, `practitionerDashboardController.js`, `scheduleController.js` — all **display-only**: they `SELECT` the column (joined from `patients`/`assessments`) and concatenate it straight into a `patient_first_name`/`patient_last_name` string or pass it through for rendering, with no parsing or comparison logic. Confirmed by reading each query: all genuinely join `patients`/`assessments`, not `practitioners`.
- `dashboardController.js` — **also display-only, but runs its own direct `pool.query` against `assessments`** (two separate sites) rather than reading already-decrypted data from another controller. An earlier draft of this list wrongly assumed this file was "already accounted for" without checking; corrected during the implementation-plan's self-review.
- `patientRecordExportController.js` — **also display-only, and the single highest-priority site in this whole list**: this is the Record of Access / full-record-export feature, the product's most FERPA/Part-C-compliance-critical export. It runs 3 of its own direct `pool.query` sites against `patients`/`assessments` (not reading from another controller's decrypted output). Same correction as `dashboardController.js` above — this was wrongly assumed covered elsewhere in an earlier draft of this list.
- `agencyPractitionerSummary.js`, `invoiceData.js` — confirmed **pure functions** (by reading each file's own header comment) that operate on rows their callers already fetched; no code change needed in these two files themselves as long as every one of their callers (`billingController.js`, `reportController.js`, `practitionerDashboardController.js`, `dashboardController.js`) decrypts before calling in.
- `companyController.js:589` (`excelDateToISO(cellValue)` for a `compareTo === 'patient_dob'` custom-field mapping in an Excel import) is a parsing site but operates on the **uploaded Excel cell value**, not the stored encrypted column — no change needed there.
- `companyController.js:126`, `dashboardController.js:129`, `messageController.js:57` — all three were initially suspected of sorting child names in SQL, but on reading each query in full, all three sort `practitioners.first_name`/`last_name` (Access Roster, "no activity" list, and conversation list respectively), never `patients`/`assessments`. **Confirmed out of scope**, no change needed.
- `sessionDraftsController.js` — display-only (`listDrafts`'s `patients` join), confirmed by reading the query; genuinely needs a decrypt call, folded into the display-only task.
- `routes/patientRoutes.js` — **a 4th NJEIS-form-filling site**, found only on a third verification pass: despite its filename suggesting "routing only," its `/generate-pdf/:assessmentId` route directly fills PDF form fields (`Childs First Name`/`Childs Last Name`/`DOB`) from a raw `SELECT * FROM assessments` query, with no controller layer in between. Same risk category as the 3 `billingController.js` NJEIS sites — a file name is not a reliable signal of what a file does; this was nearly missed twice.
- `testdata/loadAgency.js` — a **write path**, not a read path: a bulk demo-agency-seeding INSERT that writes child name/DOB/session-notes as plaintext directly into columns this plan encrypts. Low production risk (demo/test data only), but left unencrypted it would silently undermine testing the encrypted path with realistic data. Needs the same `encryptField()`/`hmacIndex()` treatment as the other write paths.
- `patientController.js`, `patientDirectoryController.js`, `reportController.js`, `createAssessment.js`, `dateChangeResign.js`, `billingController.js`, `testDataController.js` — already accounted for above (sort/search rewrites, write-path `_idx` updates, or test-tooling fixes).

**A fourth, even later pass** (run with a broader grep pattern —
`\.dob\b` in addition to the 4 specific field names, since the narrower
pattern this spec used throughout had itself been proven too narrow)
found two more sites: `consentReportController.js:427`'s own
`SELECT * FROM patients WHERE id = $1`, feeding the consent-scoped
disclosure packet's cover page (a second parent/recipient-facing
compliance PDF, distinct from the Record of Access export); and
confirmed `testdata/realisticAgency.js` needs no change (a pure
in-memory fixture builder with no database access of its own — its
output is persisted by `loadAgency.js`, already covered).

**A note on how these were found:** the first full-repo grep pass
(146 hits) correctly listed every file touching `dob`/`patient_dob` etc.,
but this spec's own summary of "already accounted for" vs. "display-only"
was written from memory of what each file *probably* did, not from
re-reading each one. Two were wrongly cleared (`dashboardController.js`,
`patientRecordExportController.js` — both assumed to read already-decrypted
data from another controller, when in fact both run their own direct
queries) and three were never checked at all
(`sessionDraftsController.js`, `routes/patientRoutes.js`,
`testdata/loadAgency.js`). All five were caught only during the
implementation plan's own self-review, by actually opening each file
and reading its real query — the same discipline this spec applied to
the controllers in its first pass, applied late to the rest. The lesson
for any future gap-closing work on this codebase: "the grep found it, I
categorized it, therefore it's handled" is not verification — only
reading the actual code is.

The implementation plan can treat this file list as the complete set of
backend call sites to update — re-run the same grep after implementation,
before claiming the task done, as a final check that no new call site
was introduced and nothing was missed.

## What does NOT need to change

- `assessments.form_data` and `assessment_notes.note` stay plaintext (out of scope, see above).
- PDF generation, exports, consent-scoped packets: these already read patient/assessment rows through the controllers that will apply `decryptField()` — once the controller layer decrypts on read, every downstream consumer (PDF builders, EIMS reconciliation, invoice generation) sees plaintext exactly as today. No changes needed there as long as every read path is updated to decrypt.
