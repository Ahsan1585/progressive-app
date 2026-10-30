# Child PII Field-Level Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add application-level AES-256-GCM encryption to child name, DOB,
and clinical session-note fields in `patients`/`assessments` — the last
open gap in FERPA/IDEA Part C pillar 6 (Technical Security) — without
breaking any of the ~25 existing call sites that read, write, search,
sort, or compare these fields, and without corrupting the official
NJEIS/SEVF state forms the product files.

**Architecture:** Extend the existing `backend/src/utils/fieldEncryption.js`
(currently SSN-only) with a second key (`FIELD_INDEX_KEY`) for a
deterministic HMAC "blind index" used only where SQL search/sort against
these columns is unavoidable. Two shared row-level helpers
(`decryptPatientRow`, `decryptAssessmentRow`) centralize decrypt-on-read
so every one of the ~25 call sites gets one function call instead of
hand-duplicated `decryptField()` calls. `patients.dob` and
`assessments.patient_dob` change from SQL `date` to `text` (confirmed
safe: a global pg type parser already treats every `date` column as a
raw string app-wide). Sort moves from SQL `ORDER BY` to in-app `.sort()`
on already-small, already-paginated result sets; free-text name search
moves from SQL `ILIKE` to decrypt-then-filter on the same
already-date/status-bounded candidate sets.

**Tech Stack:** Node.js, `pg`, Jest 30, existing `crypto` module (no new
dependencies).

**Spec:** `docs/superpowers/specs/2026-10-30-child-pii-field-encryption-design.md`

## Global Constraints

- Encrypt ONLY: `patients.{first_name, last_name, middle_name, dob}`, `assessments.{patient_first_name, patient_last_name, patient_dob}`, `assessments.session_notes`. Nothing else — `form_data`, `assessment_notes.note`, `parent_name`, `parent_email`, signatures stay plaintext (owner-approved scope).
- Two independent keys: `FIELD_ENCRYPTION_KEY` (existing, AES-256-GCM ciphertext) and `FIELD_INDEX_KEY` (new, HMAC-SHA256 blind index) — never derive one from the other, never reuse one for both purposes.
- Every encrypted column keeps the existing `v1:` prefix format from `fieldEncryption.js` so `decryptField()` already tolerates not-yet-migrated plaintext rows during rollout (same backward-compatible behavior as the SSN rollout).
- `hmacIndex(null)` and `hmacIndex('')` both return `null` (never hash empty/null) — an empty search term must mean "no filter," never "match every row with a null index."
- No SQL `date`-typed arithmetic exists anywhere on `patients.dob`/`assessments.patient_dob` today (verified: zero `age()`/`EXTRACT`/`date_part` call sites) — the `date` → `text` column type change is schema-safe.
- Migration follows the existing SSN pattern exactly: a manual per-tenant SQL migration file, then a manual per-tenant Node backfill script, idempotent via the `v1:` prefix check, safe to re-run.
- Every backend test file in this plan mocks `pool.query`/`pool.connect` the same way `backend/src/utils/__tests__/dateChangeResign.test.js` does (a SQL-routing `route()` helper over `jest.mock('../../config/db', ...)`) — no real database connection in any test.

## Review Focus

- **A parent's consent-management DOB check with a genuinely correct answer gets rejected.** `consentManageController.js`'s `checkDobOrFail` compares the parent's typed DOB against the stored value — if the comparison runs against ciphertext instead of the decrypted plaintext, every correct answer fails, silently locking parents out rather than erroring loudly. Task 5's test asserts a correct DOB succeeds post-encryption.
- **An EIMS compliance upload whose DOB genuinely matches gets flagged as a mismatch anyway.** `billingController.js`'s EIMS reconciliation compares `session.patient_dob` (stored) against an uploaded file's DOB — undecrypted, this silently false-flags every session, corrupting the compliance feature rather than crashing it. Task 6's test asserts a matching DOB does not flag.
- **A generated NJEIS/SEVF state form shows the wrong date of birth, not an error.** `njeisFormFiller.js`'s `pData.patient_dob.split('-')` on ciphertext either throws or silently produces wrong digits on a document filed with the state. Task 7's test asserts the rendered PDF's DOB field matches the real, decrypted date — not just that the function doesn't throw.
- **A blank/empty name search returns zero rows instead of the unfiltered list.** If `hmacIndex('')` were allowed to hash to a real digest, `WHERE first_name_idx = <hash of ''>` would match only rows with a literally blank name, not "no filter applied." Task 2's test pins the empty/null short-circuit.
- **Two children who happen to share a first name become distinguishable via the blind index alone**, without ever decrypting either row — an inherent, accepted property of deterministic HMAC indexing (documented in the spec as a known, minor leak), not a bug to fix, but worth a test that confirms the index is *only* used for `WHERE`-equality lookups and the app never exposes the raw index value in any API response.

---

### Task 1: Migration + backfill scripts (schema foundation)

**Files:**
- Create: `backend/db/migrations/add_child_pii_encryption.sql`
- Create: `backend/scripts/encryptChildPii.js`
- Modify: `backend/src/testdata/loadAgency.js:137-152` (the realistic-demo-agency bulk INSERT writes `c.firstName, c.lastName, c.dob` and `s.notes` as plaintext directly into columns this plan encrypts — found during this plan's self-review full-repo pass. Low production risk since this only seeds demo/test agencies, but once the migration applies, any row this script creates would hold plaintext in a column every read path now expects to be ciphertext-or-plaintext-tolerant — `decryptField()`'s passthrough means it would still *display* correctly, but the demo data would misleadingly appear "already migrated" when it was never actually encrypted, undermining its usefulness for testing the encrypted path specifically.)
- Test: `backend/db/migrations/__tests__/addChildPiiEncryptionMigration.test.js`
- Test: `backend/src/testdata/__tests__/loadAgency.encryption.test.js` (new file, extends the existing `backend/src/testdata/__tests__/realisticAgency.test.js` coverage — read that file first for its established mock/assertion conventions before writing this one)

**Interfaces:**
- Consumes: nothing (first task, no dependencies)
- Produces: schema columns `patients.first_name_idx`, `patients.last_name_idx`, `assessments.patient_first_name_idx`, `assessments.patient_last_name_idx` (all `text`, nullable, btree-indexed); `patients.dob` and `assessments.patient_dob` become `text` instead of `date`. Later tasks' write paths populate these columns; later tasks' read paths consume the type change.

- [ ] **Step 1: Write the failing migration test**

Follow the pattern in `backend/db/migrations/__tests__/consentSigningMigration.test.js` (read that file first for the exact `pg-mem` or real-Postgres-in-Docker convention this repo uses for migration tests — use the same one). Write:

```javascript
// backend/db/migrations/__tests__/addChildPiiEncryptionMigration.test.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATION_PATH = path.join(__dirname, '..', 'add_child_pii_encryption.sql');

describe('add_child_pii_encryption migration', () => {
  it('adds the four blind-index columns and widens dob to text', async () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toMatch(/ALTER TABLE patients[\s\S]*ADD COLUMN.*first_name_idx/i);
    expect(sql).toMatch(/ALTER TABLE patients[\s\S]*ADD COLUMN.*last_name_idx/i);
    expect(sql).toMatch(/ALTER TABLE assessments[\s\S]*ADD COLUMN.*patient_first_name_idx/i);
    expect(sql).toMatch(/ALTER TABLE assessments[\s\S]*ADD COLUMN.*patient_last_name_idx/i);
    expect(sql).toMatch(/ALTER TABLE patients[\s\S]*ALTER COLUMN dob TYPE text/i);
    expect(sql).toMatch(/ALTER TABLE assessments[\s\S]*ALTER COLUMN patient_dob TYPE text/i);
    expect(sql).toMatch(/CREATE INDEX.*first_name_idx/i);
    expect(sql).toMatch(/CREATE INDEX.*last_name_idx/i);
  });

  it('is safe to run twice (IF NOT EXISTS / IF EXISTS guards)', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    const alterAddLines = sql.match(/ADD COLUMN[^\n]*/gi) || [];
    for (const line of alterAddLines) {
      expect(line).toMatch(/IF NOT EXISTS/i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest db/migrations/__tests__/addChildPiiEncryptionMigration.test.js`
Expected: FAIL — `add_child_pii_encryption.sql` does not exist (`ENOENT`).

- [ ] **Step 3: Write the migration SQL**

```sql
-- backend/db/migrations/add_child_pii_encryption.sql
-- Manual, per-tenant migration (same convention as
-- widen_ssn_column_for_encryption.sql) — applied once per tenant database
-- via psql, BEFORE running backend/scripts/encryptChildPii.js.
--
-- Adds a "blind index" companion column per searched/sorted name column:
-- a deterministic HMAC-SHA256 digest (computed app-side with
-- FIELD_INDEX_KEY, never the same key as FIELD_ENCRYPTION_KEY) that lets
-- SQL do exact-match WHERE lookups against an encrypted column without
-- ever storing or querying the plaintext. No index column exists for
-- dob — it is never substring-searched, and the few exact-match/compare
-- use sites decrypt-and-compare in application code on small result sets.
--
-- Changes patients.dob and assessments.patient_dob from `date` to `text`
-- because an AES-256-GCM ciphertext string cannot be stored in a `date`
-- column. Confirmed safe: backend/src/config/tenantPoolRegistry.js already
-- forces every `date` column, app-wide, to be read back as a raw
-- "YYYY-MM-DD" string (not a JS Date) via a global pg type parser — so
-- every consumer of these two columns already treats them as strings,
-- this just makes the schema match what the app already assumes.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS first_name_idx text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS last_name_idx text;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS patient_first_name_idx text;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS patient_last_name_idx text;

CREATE INDEX IF NOT EXISTS idx_patients_first_name_idx ON patients (first_name_idx);
CREATE INDEX IF NOT EXISTS idx_patients_last_name_idx ON patients (last_name_idx);
CREATE INDEX IF NOT EXISTS idx_assessments_patient_first_name_idx ON assessments (patient_first_name_idx);
CREATE INDEX IF NOT EXISTS idx_assessments_patient_last_name_idx ON assessments (patient_last_name_idx);

ALTER TABLE patients ALTER COLUMN dob TYPE text;
ALTER TABLE assessments ALTER COLUMN patient_dob TYPE text;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest db/migrations/__tests__/addChildPiiEncryptionMigration.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Write the backfill script**

Mirror `backend/scripts/encryptExistingSsns.js` exactly (read it first),
extended to cover all 7 columns and compute the blind index alongside
the ciphertext for the 4 indexed columns:

```javascript
// backend/scripts/encryptChildPii.js
// One-time backfill: encrypts plaintext patients.{first_name, last_name,
// middle_name, dob} and assessments.{patient_first_name, patient_last_name,
// patient_dob, session_notes} already stored in a tenant database, using
// the same AES-256-GCM scheme the app now applies on every new write (see
// fieldEncryption.js). Run manually, once per tenant, AFTER
// add_child_pii_encryption.sql has applied. Also computes and stores the
// blind-index HMAC for first_name/last_name on both tables.
//
// Safe to re-run: any row whose target column already starts with "v1:" is
// skipped for that column, so running this twice is a no-op the second time.
//
// Usage (from backend/, with the Cloud SQL Auth Proxy running on
// 127.0.0.1:5433):
//   FIELD_ENCRYPTION_KEY=<key> FIELD_INDEX_KEY=<key> node scripts/encryptChildPii.js <tenant_db_name>
const { Pool } = require('pg');
const { encryptField, hmacIndex } = require('../src/utils/fieldEncryption');

const ALREADY_DONE = (v) => typeof v === 'string' && v.startsWith('v1:');

async function main() {
  const tenantDbName = process.argv[2];
  if (!tenantDbName) {
    console.error('Usage: node scripts/encryptChildPii.js <tenant_db_name>');
    process.exit(1);
  }
  if (!process.env.FIELD_ENCRYPTION_KEY || !process.env.FIELD_INDEX_KEY) {
    console.error('FIELD_ENCRYPTION_KEY and FIELD_INDEX_KEY must both be set to the values the running app uses.');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    user: process.env.DB_USER || 'njeis_app',
    password: process.env.DB_PASSWORD,
    database: tenantDbName,
  });

  try {
    const { rows: patients } = await pool.query(
      `SELECT id, first_name, last_name, middle_name, dob FROM patients`
    );
    let patientsDone = 0;
    for (const row of patients) {
      if (ALREADY_DONE(row.first_name)) continue;
      await pool.query(
        `UPDATE patients SET first_name = $1, last_name = $2, middle_name = $3, dob = $4,
                first_name_idx = $5, last_name_idx = $6 WHERE id = $7`,
        [
          encryptField(row.first_name),
          encryptField(row.last_name),
          row.middle_name ? encryptField(row.middle_name) : row.middle_name,
          row.dob ? encryptField(row.dob) : row.dob,
          hmacIndex(row.first_name),
          hmacIndex(row.last_name),
          row.id,
        ]
      );
      patientsDone += 1;
    }

    const { rows: assessments } = await pool.query(
      `SELECT id, patient_first_name, patient_last_name, patient_dob, session_notes FROM assessments`
    );
    let assessmentsDone = 0;
    for (const row of assessments) {
      if (ALREADY_DONE(row.patient_first_name)) continue;
      await pool.query(
        `UPDATE assessments SET patient_first_name = $1, patient_last_name = $2, patient_dob = $3,
                session_notes = $4, patient_first_name_idx = $5, patient_last_name_idx = $6 WHERE id = $7`,
        [
          encryptField(row.patient_first_name),
          encryptField(row.patient_last_name),
          row.patient_dob ? encryptField(row.patient_dob) : row.patient_dob,
          row.session_notes ? encryptField(row.session_notes) : row.session_notes,
          hmacIndex(row.patient_first_name),
          hmacIndex(row.patient_last_name),
          row.id,
        ]
      );
      assessmentsDone += 1;
    }

    console.log(`Encrypted ${patientsDone} patients rows, ${assessmentsDone} assessments rows.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 6: Fix `loadAgency.js`'s demo-seeding INSERT to encrypt on write**

Read `backend/src/testdata/loadAgency.js` in full around lines 130-160
to confirm the real variable names (`c` for child, `s` for session) and
`COLS` array, then:

1. Add `const { encryptField, hmacIndex } = require('../utils/fieldEncryption');` to this file's imports.
2. Change line 139 from `c.firstName, c.lastName, c.dob, c.county,` to `encryptField(c.firstName), encryptField(c.lastName), encryptField(c.dob), c.county,`.
3. Change line 145's `s.notes || null` to `s.notes ? encryptField(s.notes) : null`.
4. Add `patient_first_name_idx`, `patient_last_name_idx` to the `COLS` array (line 149) and `hmacIndex(c.firstName), hmacIndex(c.lastName)` to the corresponding row-building array (end of the `return [...]` block at line 137-146).

Write the test:

```javascript
// backend/src/testdata/__tests__/loadAgency.encryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

// Read backend/src/testdata/__tests__/realisticAgency.test.js first to
// match its existing pool.query mocking convention for loadAgency.js
// exactly — this file seeds through the same bulk-insert code path.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { decryptField } = require('../../utils/fieldEncryption');

describe('loadAgency seeding writes encrypted patient identity fields', () => {
  it('stores child first_name/last_name/dob/session_notes encrypted, not plaintext', async () => {
    // Drive whichever exported seeding function in loadAgency.js performs
    // the bulk INSERT at lines 137-152 (confirm the real name by reading
    // the file's module.exports), with a minimal fixture producing at
    // least one child + one session, then assert the captured INSERT
    // params at the patient_first_name/patient_last_name/patient_dob/
    // session_notes column positions decrypt back to the known plaintext
    // fixture values — mirroring the exact assertion style used in Task
    // 4's createAssessment.encryption.test.js (reading column names out
    // of the SQL text to find each value's param index).
  });
});
```

Fill in the real function name and fixture shape by reading the file
first — this is drafting shorthand, not a placeholder to leave in the
committed test.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && npx jest src/testdata/__tests__/loadAgency.encryption.test.js src/testdata/__tests__/realisticAgency.test.js`
Expected: PASS (new test), and the pre-existing `realisticAgency.test.js`
suite still PASSES — update any of its fixtures/assertions that assumed
plaintext values at specific SQL param positions.

- [ ] **Step 8: Commit**

```bash
git add backend/db/migrations/add_child_pii_encryption.sql backend/scripts/encryptChildPii.js backend/src/testdata/loadAgency.js backend/db/migrations/__tests__/addChildPiiEncryptionMigration.test.js backend/src/testdata/__tests__/loadAgency.encryption.test.js
git commit -m "Add child PII encryption migration, backfill script, and demo-seed fix

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `fieldEncryption.js` — add `hmacIndex` and row-level decrypt helpers

**Files:**
- Modify: `backend/src/utils/fieldEncryption.js`
- Test: `backend/src/utils/__tests__/fieldEncryption.test.js` (new file — none exists today)

**Interfaces:**
- Consumes: `encryptField`/`decryptField` (already exist in this file, unchanged)
- Produces: `hmacIndex(plaintext) -> string|null`, `decryptPatientRow(row) -> row` (mutates and returns a copy with `first_name`/`last_name`/`middle_name`/`dob` decrypted, `first_name_idx`/`last_name_idx` stripped from the returned object so the raw index never reaches an API response), `decryptAssessmentRow(row) -> row` (same, for `patient_first_name`/`patient_last_name`/`patient_dob`/`session_notes`). Every later task's read path calls one of these two functions.

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/utils/__tests__/fieldEncryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');
const { encryptField, decryptField, hmacIndex, decryptPatientRow, decryptAssessmentRow } = require('../fieldEncryption');

describe('hmacIndex', () => {
  it('returns null for null, undefined, and empty string without hashing', () => {
    expect(hmacIndex(null)).toBeNull();
    expect(hmacIndex(undefined)).toBeNull();
    expect(hmacIndex('')).toBeNull();
  });

  it('is deterministic and case/whitespace-insensitive', () => {
    expect(hmacIndex('Luz')).toBe(hmacIndex('luz'));
    expect(hmacIndex(' Luz ')).toBe(hmacIndex('luz'));
  });

  it('produces different digests for different names', () => {
    expect(hmacIndex('Luz')).not.toBe(hmacIndex('Omar'));
  });
});

describe('decryptPatientRow', () => {
  it('decrypts first_name, last_name, middle_name, dob and strips the index columns', () => {
    const row = {
      id: 1,
      first_name: encryptField('Luz'),
      last_name: encryptField('Quintero'),
      middle_name: encryptField('Marie'),
      dob: encryptField('2024-03-05'),
      first_name_idx: hmacIndex('Luz'),
      last_name_idx: hmacIndex('Quintero'),
      county: 'Essex',
    };
    const result = decryptPatientRow(row);
    expect(result.first_name).toBe('Luz');
    expect(result.last_name).toBe('Quintero');
    expect(result.middle_name).toBe('Marie');
    expect(result.dob).toBe('2024-03-05');
    expect(result.county).toBe('Essex');
    expect(result).not.toHaveProperty('first_name_idx');
    expect(result).not.toHaveProperty('last_name_idx');
  });

  it('returns null unchanged, not an error', () => {
    expect(decryptPatientRow(null)).toBeNull();
  });

  it('passes through plaintext rows unchanged (pre-backfill tolerance)', () => {
    const row = { id: 2, first_name: 'Plain', last_name: 'Name', dob: '2024-01-01' };
    const result = decryptPatientRow(row);
    expect(result.first_name).toBe('Plain');
    expect(result.dob).toBe('2024-01-01');
  });
});

describe('decryptAssessmentRow', () => {
  it('decrypts patient_first_name, patient_last_name, patient_dob, session_notes and strips index columns', () => {
    const row = {
      id: 9,
      patient_first_name: encryptField('Luz'),
      patient_last_name: encryptField('Quintero'),
      patient_dob: encryptField('2024-03-05'),
      session_notes: encryptField('Worked on stacking rings.'),
      patient_first_name_idx: hmacIndex('Luz'),
      patient_last_name_idx: hmacIndex('Quintero'),
      billing_status: 'pending',
    };
    const result = decryptAssessmentRow(row);
    expect(result.patient_first_name).toBe('Luz');
    expect(result.patient_last_name).toBe('Quintero');
    expect(result.patient_dob).toBe('2024-03-05');
    expect(result.session_notes).toBe('Worked on stacking rings.');
    expect(result.billing_status).toBe('pending');
    expect(result).not.toHaveProperty('patient_first_name_idx');
    expect(result).not.toHaveProperty('patient_last_name_idx');
  });

  it('returns null unchanged, not an error', () => {
    expect(decryptAssessmentRow(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/utils/__tests__/fieldEncryption.test.js`
Expected: FAIL — `hmacIndex`, `decryptPatientRow`, `decryptAssessmentRow` are not exported (undefined is not a function).

- [ ] **Step 3: Implement**

```javascript
// Add to backend/src/utils/fieldEncryption.js, after the existing
// encryptField/decryptField functions, before module.exports.

function getIndexKey() {
  const keyB64 = process.env.FIELD_INDEX_KEY;
  if (!keyB64) {
    throw new Error('FIELD_INDEX_KEY is not set — cannot compute a blind index for name fields.');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error(`FIELD_INDEX_KEY must decode to exactly 32 bytes (got ${key.length}).`);
  }
  return key;
}

// Deterministic HMAC-SHA256 "blind index" for exact-match SQL lookups
// against an encrypted column, WITHOUT ever storing or querying plaintext.
// Uses a key independent from FIELD_ENCRYPTION_KEY: compromising one key
// doesn't help attack the other, and the index is never reversible back to
// plaintext on its own — it only supports equality comparison.
//
// Returns null (never a real digest) for null/undefined/empty input, so a
// blank search term can be treated by callers as "no filter applied"
// instead of accidentally matching every row with a null/blank name.
function hmacIndex(plaintext) {
  const normalized = (plaintext === null || plaintext === undefined) ? '' : String(plaintext).trim().toLowerCase();
  if (normalized === '') return null;
  return crypto.createHmac('sha256', getIndexKey()).update(normalized, 'utf8').digest('hex');
}

// Decrypts the identity fields on a `patients` row read from the database,
// and strips the blind-index columns from the returned object so a raw
// HMAC digest never leaks into an API response (it has no legitimate use
// outside a SQL WHERE clause). Tolerates a row that's already plaintext
// (pre-backfill) via decryptField's existing "no v1: prefix" passthrough.
function decryptPatientRow(row) {
  if (!row) return row;
  const { first_name_idx, last_name_idx, ...rest } = row;
  return {
    ...rest,
    first_name: decryptField(row.first_name),
    last_name: decryptField(row.last_name),
    middle_name: decryptField(row.middle_name),
    dob: decryptField(row.dob),
  };
}

// Same as decryptPatientRow, for the session-time identity snapshot and
// clinical narrative on an `assessments` row.
function decryptAssessmentRow(row) {
  if (!row) return row;
  const { patient_first_name_idx, patient_last_name_idx, ...rest } = row;
  return {
    ...rest,
    patient_first_name: decryptField(row.patient_first_name),
    patient_last_name: decryptField(row.patient_last_name),
    patient_dob: decryptField(row.patient_dob),
    session_notes: decryptField(row.session_notes),
  };
}

module.exports = { encryptField, decryptField, hmacIndex, decryptPatientRow, decryptAssessmentRow };
```

Also update the file's header comment (currently says "a small number of
especially sensitive columns — currently just practitioners.ssn") to
reflect that this module now also covers child name/DOB/session-notes
encryption and the blind-index mechanism — one or two sentences, not a
rewrite.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/utils/__tests__/fieldEncryption.test.js`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/fieldEncryption.js backend/src/utils/__tests__/fieldEncryption.test.js
git commit -m "Add blind-index and row-decrypt helpers for child PII encryption

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `patientController.js` write paths — encrypt on create/update, compute blind index

**Files:**
- Modify: `backend/src/controllers/patientController.js:48-186` (`registerPatient`, `getPatients`, `updatePatient`)
- Test: `backend/src/controllers/__tests__/patientController.encryption.test.js` (new file)

**Interfaces:**
- Consumes: `encryptField`, `hmacIndex`, `decryptPatientRow` from Task 2 (`backend/src/utils/fieldEncryption.js`)
- Produces: `patients` rows are now stored encrypted; `getPatients`/`registerPatient`/`updatePatient` responses return decrypted plaintext (unchanged shape from the caller's point of view) — later tasks that read `patients` rows via these same functions get plaintext for free.

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/controllers/__tests__/patientController.encryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { encryptField, hmacIndex, decryptField } = require('../../utils/fieldEncryption');
const { registerPatient, getPatients, updatePatient } = require('../patientController');

function mockReqRes(body = {}, params = {}) {
  const req = { body, params, practitioner: { practitionerId: 3 } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}

afterEach(() => jest.resetAllMocks());

describe('registerPatient', () => {
  it('stores first_name/last_name/dob encrypted and their HMAC index alongside', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // existing child_id check: none found
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), dob: encryptField('2024-03-05') }] }) // INSERT ... RETURNING *
      .mockResolvedValueOnce({ rows: [] }); // patient_practitioners insert

    const { req, res } = mockReqRes({
      firstName: 'Luz', lastName: 'Quintero', dob: '2024-03-05', county: 'Essex', childId: 'CH-100',
    });
    await registerPatient(req, res);

    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO patients/.test(sql));
    const [, params] = insertCall;
    expect(params[0]).not.toBe('Luz'); // first_name param is ciphertext, not plaintext
    expect(decryptField(params[0])).toBe('Luz');
    expect(decryptField(params[2])).toBe('Quintero'); // last_name
    expect(decryptField(params[3])).toBe('2024-03-05'); // dob
  });
});

describe('getPatients', () => {
  it('returns decrypted plaintext names/dob, not ciphertext, and strips the index columns', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero'),
        middle_name: null, dob: encryptField('2024-03-05'),
        first_name_idx: hmacIndex('Luz'), last_name_idx: hmacIndex('Quintero'),
        status: 'active',
      }],
    });
    const { req, res } = mockReqRes();
    await getPatients(req, res);

    expect(res.body[0].first_name).toBe('Luz');
    expect(res.body[0].last_name).toBe('Quintero');
    expect(res.body[0].dob).toBe('2024-03-05');
    expect(res.body[0]).not.toHaveProperty('first_name_idx');
    expect(res.body[0]).not.toHaveProperty('last_name_idx');
  });

  it('sorts the returned list alphabetically by last_name in application code', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, first_name: encryptField('Zoe'), last_name: encryptField('Yang'), dob: encryptField('2023-01-01'), status: 'active' },
        { id: 2, first_name: encryptField('Amy'), last_name: encryptField('Alpha'), dob: encryptField('2023-01-01'), status: 'active' },
      ],
    });
    const { req, res } = mockReqRes();
    await getPatients(req, res);
    expect(res.body.map((p) => p.last_name)).toEqual(['Alpha', 'Yang']);
  });
});

describe('updatePatient', () => {
  it('stores updated first_name/last_name/dob encrypted with a refreshed HMAC index', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero-Reyes'), dob: encryptField('2024-03-05') }] }); // UPDATE ... RETURNING *

    const { req, res } = mockReqRes(
      { firstName: 'Luz', lastName: 'Quintero-Reyes', dob: '2024-03-05', county: 'Essex', childId: 'CH-100' },
      { id: '5' }
    );
    await updatePatient(req, res);

    const updateCall = pool.query.mock.calls.find(([sql]) => /UPDATE patients/.test(sql));
    const [, params] = updateCall;
    expect(decryptField(params[2])).toBe('Quintero-Reyes'); // last_name param position
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/patientController.encryption.test.js`
Expected: FAIL — stored params are plaintext, `getPatients` response includes `first_name_idx`/`last_name_idx` and isn't sorted by last_name (the un-encrypted current behavior relies on SQL doing it, which this test's mock doesn't provide).

- [ ] **Step 3: Implement**

Add the import at the top of `patientController.js`:

```javascript
const { encryptField, hmacIndex, decryptPatientRow } = require('../utils/fieldEncryption');
```

Rewrite the `registerPatient` INSERT block (currently lines 77-92) to encrypt before storing and decrypt the `RETURNING *` row before it's sent back:

```javascript
    const { rows } = await pool.query(
      `INSERT INTO patients (first_name, middle_name, last_name, dob, county, child_id, practitioner_id, parent_name, parent_email, first_name_idx, last_name_idx)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        encryptField(validatedData.firstName),
        validatedData.middleName ? encryptField(validatedData.middleName) : null,
        encryptField(validatedData.lastName),
        encryptField(validatedData.dob),
        validatedData.county,
        validatedData.childId,
        practitionerId,
        validatedData.parentName || null,
        validatedData.parentEmail || null,
        hmacIndex(validatedData.firstName),
        hmacIndex(validatedData.lastName),
      ]
    );
```

And the response at line 100-103:

```javascript
    res.status(201).json({
      message: "Patient registered successfully",
      data: decryptPatientRow(rows[0]),
    });
```

The "existing child" early-return path (lines 52-73) also returns `data: existing` — decrypt it the same way:

```javascript
      return res.status(201).json({
        message: 'This child was already registered — linked to your patient list.',
        linked: true,
        data: decryptPatientRow(existing),
      });
```

Rewrite `getPatients` (lines 118-141): decrypt every row, then sort by
`last_name` in Node since the column is no longer sortable in SQL (the
query itself drops no ORDER BY since there was none on name to begin
with — the sort was implicit via whatever order Postgres returned rows,
which is not guaranteed; this task adds an explicit, deterministic
application-side sort that the current code never had):

```javascript
    const { rows: rawPatients } = await pool.query(
      `SELECT p.*, pp.status,
              (SELECT MAX(a.service_date) FROM assessments a WHERE a.patient_id = p.id AND a.practitioner_id = $1) AS last_service_date
       FROM patients p
       JOIN patient_practitioners pp ON pp.patient_id = p.id
       WHERE pp.practitioner_id = $1 AND pp.deactivated_reason IS DISTINCT FROM 'reassigned'`,
      [practitionerId]
    );
    const patients = rawPatients
      .map(decryptPatientRow)
      .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
```

Rewrite the `updatePatient` UPDATE block (lines 161-177):

```javascript
    const { rows } = await pool.query(
      `UPDATE patients
       SET first_name = $1, middle_name = $2, last_name = $3, dob = $4, county = $5, child_id = $6, parent_name = $7, parent_email = $8,
           first_name_idx = $9, last_name_idx = $10
       WHERE id = $11
       RETURNING *`,
      [
        encryptField(validatedData.firstName),
        validatedData.middleName ? encryptField(validatedData.middleName) : null,
        encryptField(validatedData.lastName),
        encryptField(validatedData.dob),
        validatedData.county,
        validatedData.childId,
        validatedData.parentName || null,
        validatedData.parentEmail || null,
        hmacIndex(validatedData.firstName),
        hmacIndex(validatedData.lastName),
        id,
      ]
    );

    logAudit({ req, action: 'patient_update', resourceType: 'patient', resourceId: id });
    res.json({ message: 'Patient updated successfully', data: decryptPatientRow(rows[0]) });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/patientController.encryption.test.js`
Expected: PASS (4/4)

- [ ] **Step 5: Run the full existing patientController test suite to confirm no regression**

Run: `cd backend && npx jest src/controllers/__tests__/ -t "patient"`
Expected: all pre-existing patient-related tests still PASS (this task changed SQL param positions/counts — any existing test asserting exact param arrays by position needs updating as part of this task, not left red)

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/patientController.js backend/src/controllers/__tests__/patientController.encryption.test.js
git commit -m "Encrypt patients name/dob fields in patientController write and read paths

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `createAssessment.js` and `dateChangeResign.js` write paths

**Files:**
- Modify: `backend/src/utils/createAssessment.js:89-124` (`createAssessmentFromPayload`)
- Modify: `backend/src/utils/dateChangeResign.js` (wherever it writes `patient_first_name`/`patient_last_name`/`patient_dob`/`session_notes` — read the file first to find the exact UPDATE statement, following the same pattern as Task 3)
- Test: `backend/src/utils/__tests__/createAssessment.encryption.test.js` (new file)

**Interfaces:**
- Consumes: `encryptField`, `hmacIndex` from Task 2. Also consumes the fact (from Task 3) that `patientController.js`'s callers of `createAssessmentFromPayload` now pass already-decrypted plaintext `patient_first_name`/`patient_last_name`/`patient_dob` (read from a `decryptPatientRow`-processed `patients` row) — this task's function encrypts on the way into `assessments`, it does not need to decrypt anything on the way in.
- Produces: `assessments` rows store identity snapshot + session_notes encrypted with their blind index populated; the `RETURNING *` row this function returns is still ciphertext (callers that need plaintext call `decryptAssessmentRow` themselves — this function's job is to write, not to shape the response).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/utils/__tests__/createAssessment.encryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { decryptField } = require('../fieldEncryption');
const { createAssessmentFromPayload } = require('../createAssessment');

afterEach(() => jest.resetAllMocks());

describe('createAssessmentFromPayload', () => {
  it('encrypts patient_first_name, patient_last_name, patient_dob, session_notes and sets the blind index', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // findConflictingSession
      .mockResolvedValueOnce({ rows: [{ id: 99 }] }); // INSERT ... RETURNING *

    await createAssessmentFromPayload({
      patientId: 5, practitionerId: 3,
      patient_first_name: 'Luz', patient_last_name: 'Quintero', patient_dob: '2024-03-05', patient_county: 'Essex',
      practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy', practitioner_discipline: 'PT',
      date: '2026-10-29', startTime: '10:00', endTime: '11:00', totalTime: 60,
      status: '1', type: 'PT', location: '1', groupSizeCategory: null,
      parentSignatureBase64: 'data:a', practitionerSignatureBase64: 'data:b',
      sanitizedCustomFields: {}, note: 'Worked on stacking rings.',
    });

    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO assessments/.test(sql));
    const [sql, params] = insertCall;
    const colList = sql.match(/\(([^)]+)\)/)[1].split(',').map((s) => s.trim());
    const get = (col) => params[colList.indexOf(col)];

    expect(decryptField(get('patient_first_name'))).toBe('Luz');
    expect(decryptField(get('patient_last_name'))).toBe('Quintero');
    expect(decryptField(get('patient_dob'))).toBe('2024-03-05');
    expect(decryptField(get('session_notes'))).toBe('Worked on stacking rings.');
    expect(get('patient_first_name_idx')).toBeTruthy();
    expect(get('patient_last_name_idx')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/utils/__tests__/createAssessment.encryption.test.js`
Expected: FAIL — `colList.indexOf('patient_first_name_idx')` is `-1` (column doesn't exist in the INSERT yet), and the stored values are plaintext, not ciphertext.

- [ ] **Step 3: Implement**

Add the import to `createAssessment.js`:

```javascript
const { encryptField, hmacIndex } = require('./fieldEncryption');
```

Rewrite the INSERT (currently lines 107-124):

```javascript
  const { rows: insertedRows } = await pool.query(
    `INSERT INTO assessments
       (patient_id, practitioner_id, patient_first_name, patient_last_name, patient_dob, patient_county,
        practitioner_first_name, practitioner_last_name, practitioner_discipline,
        service_date, start_time, end_time, total_time, status, type, location, group_size_category,
        parent_signature, practitioner_signature, form_data, billing_status, company_affiliation, session_notes,
        patient_first_name_idx, patient_last_name_idx)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
     RETURNING *`,
    [
      patientId, practitionerId,
      encryptField(patient_first_name), encryptField(patient_last_name), encryptField(patient_dob), patient_county,
      practitioner_first_name, practitioner_last_name, practitioner_discipline,
      date, startTime, endTime, totalTime, status, type, location, groupSizeCategory || null,
      parentSignatureBase64, practitionerSignatureBase64,
      JSON.stringify({ custom_fields: sanitizedCustomFields || {} }),
      billingStatus || 'pending', companyAffiliation || null,
      note && note.trim() ? encryptField(note.trim()) : null,
      hmacIndex(patient_first_name), hmacIndex(patient_last_name),
    ]
  );
```

Now read `backend/src/utils/dateChangeResign.js` in full and find its
`UPDATE assessments` statement that sets `patient_first_name`/
`patient_last_name`/`patient_dob`/`session_notes` (the date-change/resign
flow re-snapshots these on a date edit). Apply the identical treatment:
wrap each of those 4 values in `encryptField()` on the way in, add
`patient_first_name_idx`/`patient_last_name_idx` to the column list and
params using `hmacIndex()`. Add the same
`const { encryptField, hmacIndex } = require('./fieldEncryption');`
import at the top of that file. Write the equivalent test file
`backend/src/utils/__tests__/dateChangeResign.encryption.test.js`
following the existing `backend/src/utils/__tests__/dateChangeResign.test.js`
mock pattern (the `route()` SQL-routing helper), asserting the UPDATE's
params are ciphertext and the index columns are populated — mirror the
assertion style from Step 1 above exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/utils/__tests__/createAssessment.encryption.test.js src/utils/__tests__/dateChangeResign.encryption.test.js`
Expected: PASS (both files)

- [ ] **Step 5: Run the full existing createAssessment/dateChangeResign suites to confirm no regression**

Run: `cd backend && npx jest src/utils/__tests__/dateChangeResign.test.js src/controllers/__tests__/dateChangeResign.controllers.test.js`
Expected: all pre-existing tests still PASS; update any test whose fixture or assertion assumed plaintext params at specific positions.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/createAssessment.js backend/src/utils/dateChangeResign.js backend/src/utils/__tests__/createAssessment.encryption.test.js backend/src/utils/__tests__/dateChangeResign.encryption.test.js
git commit -m "Encrypt assessments identity snapshot and session_notes on write

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Consent/e-signature DOB identity verification — decrypt before compare

**Files:**
- Modify: `backend/src/controllers/consentManageController.js:46-51` (`loadRequest`'s query) and its `checkDobOrFail` consumer (lines 76-109)
- Modify: `backend/src/controllers/consentSigningController.js` (read the file first; find its equivalent DOB-check query and comparison — same pattern as `consentManageController.js`)
- Modify: `backend/src/controllers/telepracticeSignatureController.js` (same — find and fix its DOB-check query/comparison)
- Test: `backend/src/controllers/__tests__/consentManageController.dobEncryption.test.js` (new file)

**Interfaces:**
- Consumes: `decryptField` from `fieldEncryption.js` (already exported, Task 2 didn't change it)
- Produces: nothing new consumed by later tasks — this is a leaf fix, but it's the Review Focus item #1 and must have its own explicit test, not be folded into a later catch-all task.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/controllers/__tests__/consentManageController.dobEncryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');

// Read backend/src/controllers/consentManageController.js in full before
// writing this test — import whichever exported handler function calls
// checkDobOrFail (the manage-link "view" POST handler) and drive it the
// same way the file's own internal flow does.
const { handleManageDobSubmit } = require('../consentManageController');

afterEach(() => jest.resetAllMocks());

describe('consent manage DOB verification against an encrypted patient_dob', () => {
  it('succeeds when the parent types the correct DOB, even though the stored value is ciphertext', async () => {
    pool.query
      // loadRequest's SELECT: patient_dob is now ciphertext in the row
      .mockResolvedValueOnce({ rows: [{ id: 1, manage_token_hash: 'h', manage_failed_attempts: 0, manage_locked_at: null, consent_id: 7, patient_dob: encryptField('2024-03-05'), patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero') }] })
      // checkDobOrFail's claim-attempt UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      // success-path reset UPDATE
      .mockResolvedValueOnce({ rows: [] });

    const req = { params: { token: 'a'.repeat(32) }, body: { dob: '2024-03-05' } };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; } };

    await handleManageDobSubmit(req, res);

    expect(res.statusCode).not.toBe(403);
  });

  it('still rejects an incorrect DOB against the same encrypted stored value', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, manage_token_hash: 'h', manage_failed_attempts: 0, manage_locked_at: null, consent_id: 7, patient_dob: encryptField('2024-03-05'), patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero') }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, manage_failed_attempts: 1, manage_locked_at: null }] });

    const req = { params: { token: 'a'.repeat(32) }, body: { dob: '1999-01-01' } };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; } };

    await handleManageDobSubmit(req, res);

    expect(res.statusCode).toBe(403);
  });
});
```

Before finalizing this test, open `consentManageController.js` and
confirm the exact exported function name for the route handler that
calls `checkDobOrFail` (it may not be literally `handleManageDobSubmit`
— use the real name) and the exact shape of `res` it expects (it may use
`sendPage`, a custom responder, not bare `status().send()` — match
whatever the file's own `rejectPage`/`sendPage` helpers actually set on
`res`, e.g. check `res.statusCode` after calling them). Adjust the
test's assertions to match the real response-writing mechanism in the
file rather than assuming Express's bare API.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/consentManageController.dobEncryption.test.js`
Expected: FAIL — `dobToIso(request.patient_dob)` receives a ciphertext string, not a `Date`/ISO string, so `given === expected` never matches even for the correct DOB; the first test (`succeeds when...`) fails.

- [ ] **Step 3: Implement**

In `consentManageController.js`, update `loadRequest` to decrypt the 3
identity fields immediately after the query, so every downstream
consumer (`checkDobOrFail`'s comparison AND `childNameOf`/`detailsPage`'s
display) gets plaintext for free:

```javascript
async function loadRequest(req, res) {
  const { token } = req.params;
  if (!TOKEN_RE.test(String(token || ''))) { rejectPage(res, 404, 'This link is not valid.'); return null; }
  const { rows } = await pool.query(
    `SELECT r.*, p.dob AS patient_dob, p.first_name AS patient_first_name, p.last_name AS patient_last_name
     FROM records_consent_requests r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.manage_token_hash = $1`,
    [hashToken(token)]
  );
  const request = rows[0];
  if (!request || !request.consent_id) { rejectPage(res, 404, 'This link is not valid.'); return null; }
  request.patient_dob = decryptField(request.patient_dob);
  request.patient_first_name = decryptField(request.patient_first_name);
  request.patient_last_name = decryptField(request.patient_last_name);
  if (request.manage_locked_at) {
    rejectPage(res, 423, 'This link has been locked after too many incorrect attempts. Please contact the agency.');
    return null;
  }
  return request;
}
```

Add `const { decryptField } = require('../utils/fieldEncryption');` to
this file's imports.

Now open `consentSigningController.js` and `telepracticeSignatureController.js`.
Each has its own query that reads `patients.dob`/`patient_dob` for a
DOB-based identity check (same `checkDob`-style pattern — grep that file
for `dobToIso` to find the exact function and query). Apply the identical
fix: decrypt `patient_dob` (and `patient_first_name`/`patient_last_name`
if the same query selects them for display) immediately after the SQL
read, before any comparison or display use. Add the same
`decryptField` import to each file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/consentManageController.dobEncryption.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Write and pass the equivalent tests for the other two controllers**

Following the exact same two-test pattern (correct DOB succeeds against
encrypted stored value, incorrect DOB still rejected) write:
- `backend/src/controllers/__tests__/consentSigningController.dobEncryption.test.js`
- `backend/src/controllers/__tests__/telepracticeSignature.dobEncryption.test.js`

(Reuse the existing mock conventions already present in
`backend/src/controllers/__tests__/consentSigningController.test.js` and
`backend/src/controllers/__tests__/telepracticeSignature.verification.test.js`
— read both first and match their existing `pool.query` mock shape
exactly, don't invent a new one.)

Run: `cd backend && npx jest src/controllers/__tests__/consentSigningController.dobEncryption.test.js src/controllers/__tests__/telepracticeSignature.dobEncryption.test.js`
Expected: PASS (both files)

- [ ] **Step 6: Run the full existing test suites for all three touched files to confirm no regression**

Run: `cd backend && npx jest src/controllers/__tests__/consentManageController.test.js src/controllers/__tests__/consentSigningController.test.js src/controllers/__tests__/telepracticeSignature.verification.test.js`
Expected: all pre-existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/consentManageController.js backend/src/controllers/consentSigningController.js backend/src/controllers/telepracticeSignatureController.js backend/src/controllers/__tests__/consentManageController.dobEncryption.test.js backend/src/controllers/__tests__/consentSigningController.dobEncryption.test.js backend/src/controllers/__tests__/telepracticeSignature.dobEncryption.test.js
git commit -m "Decrypt patient_dob before identity-verification comparisons

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: EIMS compliance DOB matching in `billingController.js`

**Files:**
- Modify: `backend/src/controllers/billingController.js` (the EIMS compliance comparison around line 2253-2261, and whatever query feeds `session` there — read the surrounding function in full to find where that row is loaded)
- Test: `backend/src/controllers/__tests__/billingController.eimsDobMatch.test.js` (new file)

**Interfaces:**
- Consumes: `decryptField`/`decryptAssessmentRow` from `fieldEncryption.js`
- Produces: nothing consumed by later tasks — leaf fix, own explicit test per Review Focus item #2.

- [ ] **Step 1: Write the failing test**

First read `backend/src/controllers/billingController.js` around lines
2200-2270 in full to find the exact function name and how `session` is
populated before the `compareTo === 'patient_dob'` branch runs (it's fed
by a query reading `assessments`, decrypted in an earlier task only if
that same query path was already touched — if not, this task must add
the decrypt here). Then write:

```javascript
// backend/src/controllers/__tests__/billingController.eimsDobMatch.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');

// Import whichever exported function in billingController.js contains the
// compareTo === 'patient_dob' EIMS-matching branch found at the real
// billingController.js:2253-2261 — read the file to get the real name.
const { /* the real exported function name */ } = require('../billingController');

afterEach(() => jest.resetAllMocks());

describe('EIMS compliance DOB matching against an encrypted patient_dob', () => {
  it('does NOT flag a mismatch when the EIMS upload DOB matches the decrypted stored value', async () => {
    // Arrange: a session row whose patient_dob is now ciphertext for
    // '2024-03-05', and an uploaded EIMS value of the same date.
    // Assert the resulting compliance comparison's `match` field is true,
    // not false — this is the exact failure mode described in the spec:
    // undecrypted ciphertext never string-equals the uploaded plaintext.
  });
});
```

Fill in the real function name, the real call shape (how that function
is invoked in this codebase — check other tests in
`backend/src/controllers/__tests__/billingController.bulkCompliance.test.js`
for the established pattern of driving this comparison logic), and a
real assertion on the `match`/`ours`/`theirs` object shape visible at
lines 2259-2261 (`{ ours: session.patient_dob, ... match: !!session.patient_dob && !!value && session.patient_dob === value }`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/billingController.eimsDobMatch.test.js`
Expected: FAIL — `match` is `false` because `session.patient_dob` (ciphertext) never string-equals the plaintext EIMS value, even though the real underlying dates agree.

- [ ] **Step 3: Implement**

At the query that populates `session` before this comparison runs, add
`decryptField(row.patient_dob)` (or route the whole row through
`decryptAssessmentRow` if it's the same `SELECT a.*`-style query already
touched elsewhere in this file — check whether Task 7 already covers the
same query, since `billingController.js` has several `SELECT a.*,
to_jsonb(p)...` sites; if so, this task only needs to confirm that
decrypt is in place upstream of this comparison, not add a second one).
Add `const { decryptField } = require('../utils/fieldEncryption');` to
this file's imports if not already present after Task 7.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/billingController.eimsDobMatch.test.js`
Expected: PASS

- [ ] **Step 5: Run the full existing bulk-compliance suite to confirm no regression**

Run: `cd backend && npx jest src/controllers/__tests__/billingController.bulkCompliance.test.js`
Expected: all pre-existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/billingController.js backend/src/controllers/__tests__/billingController.eimsDobMatch.test.js
git commit -m "Fix EIMS DOB compliance matching against encrypted patient_dob

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `billingController.js` core billing queries + NJEIS form generation — decrypt before `.split('-')`

**Files:**
- Modify: `backend/src/controllers/billingController.js` — every `SELECT a.*, to_jsonb(p) AS practitioners, to_jsonb(pt) AS patients` / similarly-shaped query feeding `buildNjeisPdfForGroup` (confirmed sites: `runAutoGenerateForPractitioner` ~line 280, `generateNJEISForms` ~line 476+, `generateSelfCertifiedSEVF` ~line 702+ — read the file to confirm exact current line numbers before editing, since Tasks 5/6 may have shifted them)
- Modify: `backend/src/routes/patientRoutes.js:130-159` — a 4th, standalone NJEIS-form-filling site found during this plan's self-review (`GET /generate-pdf/:assessmentId`): `SELECT * FROM assessments WHERE id = $1 AND practitioner_id = $2` (line 137) feeds `form.getTextField('Childs First Name'/'Childs Last Name'/'DOB').setText(assessment.patient_first_name/patient_last_name/patient_dob)` directly (lines 151-155) — same risk category as the 3 `billingController.js` sites, genuinely missed by the spec's original pass because this file's name suggested "routing only," not PDF generation.
- Test: `backend/src/utils/__tests__/njeisFormFiller.encryption.test.js` (new file)
- Test: `backend/src/routes/__tests__/patientRoutes.njeisPdf.encryption.test.js` (new file, covers the `patientRoutes.js` site specifically)

**Interfaces:**
- Consumes: `decryptAssessmentRow` from Task 2
- Produces: by the time `patientRecords` reaches `buildNjeisPdfForGroup` (in `njeisFormFiller.js`), every record's `patient_first_name`/`patient_last_name`/`patient_dob` is plaintext — `njeisFormFiller.js` and `njeisGenerator.js` themselves need NO code changes, since the fix lives entirely at the query boundary in `billingController.js`.

- [ ] **Step 1: Write the failing test**

This is the Review Focus item #3 — the highest-stakes test in the whole
plan. It must assert the actual rendered PDF field value, not just that
the function doesn't throw.

```javascript
// backend/src/utils/__tests__/njeisFormFiller.encryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { encryptField, decryptAssessmentRow } = require('../fieldEncryption');
const { buildNjeisPdfForGroup } = require('../njeisFormFiller');

describe('buildNjeisPdfForGroup with an encrypted-at-rest patient_dob', () => {
  it('renders the correct, decrypted DOB on the generated NJEIS PDF, not ciphertext or a crash', async () => {
    const templatePath = path.join(__dirname, '..', '..', '..', 'templates', 'NJEIS-020.pdf');
    const templateBytes = fs.readFileSync(templatePath);

    // Simulate a row exactly as it comes out of the database post-encryption
    // (ciphertext), then run it through the same decrypt step billingController.js
    // now applies before calling buildNjeisPdfForGroup — this test proves the
    // FULL pipeline (encrypted storage -> decrypt -> PDF fill) produces the
    // right output, not just that decryptField round-trips in isolation.
    const encryptedRow = {
      id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
      patient_dob: encryptField('2024-03-05'), patient_county: 'Essex',
      practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy', practitioner_discipline: 'PT',
      service_date: '2026-10-29', start_time: '10:00', end_time: '11:00', total_time: 60,
      type: 'PT', location: '1', status: '1',
    };
    const decryptedRecord = decryptAssessmentRow(encryptedRow);

    const outDoc = await buildNjeisPdfForGroup(templateBytes, [decryptedRecord], 'Test Agency', { first_name: 'Omar', last_name: 'Abernathy' });
    const bytes = await outDoc.save();
    const reloaded = await PDFDocument.load(bytes);
    const dobField = reloaded.getForm().getTextField('DOB');

    // formatShortDate's exact output format is whatever njeisGenerator.js's
    // own formatShortDate produces for '2024-03-05' — read that function to
    // get the exact expected string (likely "03/05/2024" or similar) and
    // assert against the real expected value, not a guess.
    expect(dobField.getText()).not.toContain('v1:'); // never the raw ciphertext prefix
    expect(dobField.getText()).toMatch(/2024|03.05/); // contains the real decrypted date, in whatever format the form uses
  });
});
```

Before finalizing, open `njeisFormFiller.js` in full to confirm the
exact form field name used for DOB (`setUniformText('DOB', ...)` or
similar — the spec cites `fillField('DOB', ...)` from `njeisGenerator.js`
but `njeisFormFiller.js` may name it differently) and adjust the
`getTextField(...)` call to match the real field name. Also run the
existing NJEIS-form-generation tests (search for any
`*.njeis*.test.js`/`*.sevf*.test.js` under `backend/src`) to find how
this repo already asserts against generated PDF content, and match that
convention instead of inventing a new one if one already exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/utils/__tests__/njeisFormFiller.encryption.test.js`
Expected: FAIL at this stage only if `decryptAssessmentRow` wasn't applied — but since this test calls `decryptAssessmentRow` itself before passing to `buildNjeisPdfForGroup`, it should actually PASS already (this function needs no code change, per the Interfaces note above). If it passes immediately, that confirms `njeisFormFiller.js`/`njeisGenerator.js` genuinely need zero changes — the real fix belongs entirely in `billingController.js`'s query sites, verified next.

- [ ] **Step 3: Implement — fix the query sites in `billingController.js`, not the PDF filler**

Find each of the 3 confirmed sites (`runAutoGenerateForPractitioner`,
`generateNJEISForms`, `generateSelfCertifiedSEVF`) where
`SELECT a.*, to_jsonb(p) AS practitioners, to_jsonb(pt) AS patients FROM assessments a ...`
(or a similarly-shaped query) populates `assessments`/`patientRecords`
before it's grouped and passed to `buildNjeisPdfForGroup`. Immediately
after each such query's `pool.query(...)` call, decrypt every row:

```javascript
  const { rows: assessments } = await pool.query(sevfSql, sevfParams);
  // ... existing empty-check stays ...
  const decryptedAssessments = assessments.map(decryptAssessmentRow);
```

and use `decryptedAssessments` (not the raw `assessments`) for every
subsequent step in that function — the `groupedByPatient` reduce, the
`allAssessmentIds` map, and the `buildNjeisPdfForGroup` call. Repeat for
each of the other 2 sites with their own local variable names (read the
surrounding code to match whatever the existing variable is actually
called at each site — `assessments`, `logs`, `sessions`, etc., rather
than assuming they're all named identically).

Add `const { decryptAssessmentRow, decryptField } = require('../utils/fieldEncryption');`
to `billingController.js`'s imports (combine with Task 6's import if that
task already added `decryptField` here — don't duplicate the require).

Also check whether `billingController.js`'s EIMS comparison from Task 6
is fed by one of these same 3 query sites — if so, decrypting here
automatically fixes Task 6's comparison too, and Task 6's Step 3 should
simply confirm that rather than adding a second, redundant decrypt call.

Now fix `backend/src/routes/patientRoutes.js:130-159` (the
`/generate-pdf/:assessmentId` route): add
`const { decryptAssessmentRow } = require('../utils/fieldEncryption');`
to this file's imports, and immediately after line 140
(`const assessment = rows[0];`), add:

```javascript
    const assessment = decryptAssessmentRow(rows[0]);
```

Write a test asserting the generated PDF's `Childs First Name`/
`Childs Last Name`/`DOB` fields contain the real decrypted values, not
ciphertext — same assertion style as Step 1's
`njeisFormFiller.encryption.test.js` test, adapted to call this route
handler directly (mock `pool.query` to return an encrypted row, call the
Express route handler function, read the PDF buffer it sends via
`res.send`, and assert on the filled form fields).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/utils/__tests__/njeisFormFiller.encryption.test.js`
Expected: PASS (confirms the full pipeline — encrypted row, decrypted via `decryptAssessmentRow`, correct PDF output).

- [ ] **Step 5: Run the full existing billing test suite to confirm no regression**

Run: `cd backend && npx jest src/controllers/__tests__/billingController.bulkCompliance.test.js src/controllers/__tests__/ -t "NJEIS"`
Expected: all pre-existing billing/NJEIS-related tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/billingController.js backend/src/routes/patientRoutes.js backend/src/utils/__tests__/njeisFormFiller.encryption.test.js backend/src/routes/__tests__/patientRoutes.njeisPdf.encryption.test.js
git commit -m "Decrypt assessment rows before NJEIS/SEVF form generation

Includes a 4th NJEIS-form-filling site (patientRoutes.js's standalone
/generate-pdf/:assessmentId route) found during this plan's self-review
— missed by the original spec pass because the file's name suggested
routing only, not direct PDF field-filling.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Master Reports (`reportController.js`) — move name search from SQL `ILIKE` to decrypt-then-filter

**Files:**
- Modify: `backend/src/controllers/reportController.js:174` (`resolvePractitionerIds` — NOT in scope, this is a `practitioners` table search, leave as-is), `222-228` (`getAuditLogs`), `267-273` (`getSessionAuditLog`), `315-321` (`getAllPatients`), `360-366` (`generateAuditNJEIS`)
- Test: `backend/src/controllers/__tests__/reportController.nameSearchEncryption.test.js` (new file)

**Interfaces:**
- Consumes: `decryptAssessmentRow`, `decryptPatientRow` from Task 2
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/controllers/__tests__/reportController.nameSearchEncryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');
const { getAuditLogs, getSessionAuditLog, getAllPatients, generateAuditNJEIS } = require('../reportController');

function mockReqRes(query = {}, body = {}) {
  const req = { query, body };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}

afterEach(() => jest.resetAllMocks());

describe('getAuditLogs name search against encrypted patient_first_name/last_name', () => {
  it('filters to only the matching child by decrypting rows after the date/status-scoped fetch', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), practitioners: {} },
        { id: 2, patient_first_name: encryptField('Omar'), patient_last_name: encryptField('Santos'), practitioners: {} },
      ],
    });
    const { req, res } = mockReqRes({ patientSearch: 'Luz' });
    await getAuditLogs(req, res);

    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].patient_first_name).toBe('Luz');
  });

  it('returns the full date/status-scoped set unfiltered when patientSearch is empty', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), practitioners: {} },
        { id: 2, patient_first_name: encryptField('Omar'), patient_last_name: encryptField('Santos'), practitioners: {} },
      ],
    });
    const { req, res } = mockReqRes({});
    await getAuditLogs(req, res);
    expect(res.body.logs).toHaveLength(2);

    // Confirm the SQL sent to pool.query no longer includes an ILIKE clause
    // against patient_first_name/patient_last_name.
    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/patient_first_name ILIKE/i);
  });
});

describe('getAllPatients name search against encrypted first_name/last_name', () => {
  it('filters to only the matching child while still allowing child_id to match in SQL', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), child_id: 'CH-100', created_at: new Date() },
        { id: 2, first_name: encryptField('Omar'), last_name: encryptField('Santos'), child_id: 'CH-200', created_at: new Date() },
      ],
    });
    const { req, res } = mockReqRes({ patientSearch: 'Quintero' });
    await getAllPatients(req, res);

    expect(res.body.patients).toHaveLength(1);
    expect(res.body.patients[0].last_name).toBe('Quintero');
  });
});
```

(Write analogous tests for `getSessionAuditLog` and `generateAuditNJEIS`
following the exact same shape as the `getAuditLogs` tests above — same
assertion style, different function under test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/reportController.nameSearchEncryption.test.js`
Expected: FAIL — the mocked single-query response includes an `ILIKE` clause currently built into the SQL string (the `expect(sql).not.toMatch(/patient_first_name ILIKE/i)` assertion fails), and since the mock doesn't actually filter rows (it's a dumb mock returning all rows regardless of SQL), the "Luz"-only filtering assertions also fail until Node-side filtering is added.

- [ ] **Step 3: Implement**

For each of the 4 sites, remove the `ILIKE` push+clause from the SQL
string, and add a post-fetch filter on the decrypted rows. Example for
`getAuditLogs` (currently lines ~222-230):

```javascript
    if (practitionerIds) { params.push(practitionerIds); sql += ` AND a.practitioner_id = ANY($${params.length}::int[])`; }

    sql += ' ORDER BY a.service_date DESC LIMIT 1000';

    const { rows: rawLogs } = await pool.query(sql, params);
    let logs = rawLogs.map(decryptAssessmentRow);
    const term = (patientSearch || '').trim().toLowerCase();
    if (term) {
      logs = logs.filter((l) =>
        (l.patient_first_name || '').toLowerCase().includes(term) ||
        (l.patient_last_name || '').toLowerCase().includes(term)
      );
    }
    logAudit({ req, action: 'audit_logs_view', resourceType: 'audit_report', details: { count: logs.length } });
    res.json({ success: true, logs });
```

Apply the identical pattern to `getSessionAuditLog` (lines ~267-273) and
`generateAuditNJEIS` (lines ~360-366) using `decryptAssessmentRow`.

For `getAllPatients` (lines ~315-321), the existing `ILIKE` clause also
matches `pt.child_id` (which stays unencrypted and stays SQL-filterable)
— keep that part in SQL, drop only the name part:

```javascript
    if (practitionerIds) { params.push(practitionerIds); sql += ` AND pp.practitioner_id = ANY($${params.length}::int[])`; }
    const childIdTerm = (patientSearch || '').trim();
    if (childIdTerm) {
      params.push(`%${childIdTerm}%`);
      sql += ` AND pt.child_id ILIKE $${params.length}`;
    }

    sql += ' ORDER BY pt.created_at DESC LIMIT 2000';

    const { rows: rawPatients } = await pool.query(sql, params);
    let patients = rawPatients.map(decryptPatientRow);
    const nameTerm = childIdTerm.toLowerCase();
    if (nameTerm) {
      patients = patients.filter((p) =>
        (p.first_name || '').toLowerCase().includes(nameTerm) ||
        (p.last_name || '').toLowerCase().includes(nameTerm) ||
        (p.child_id || '').toLowerCase().includes(nameTerm)
      );
    }
```

(Note this changes `getAllPatients`'s search from "SQL OR across 3
columns" to "SQL filters child_id AND app-code filters name, results
unioned by the final `.filter()`" — the `childIdTerm` SQL push now
narrows by child_id OR passes everything through if no child_id matches,
then the Node filter re-applies the full 3-way OR on the decrypted page.
Double-check this produces the same *user-visible* result set as the
original 3-way `ILIKE OR` — a child matched by name but not by child_id
must still appear. If the two-stage approach above under-returns, change
the SQL to drop the `child_id ILIKE` push entirely and filter all 3
fields in Node instead, accepting the minor cost of not using the
child_id index for this one query — correctness here takes priority over
keeping a partial SQL optimization.)

Add `const { decryptAssessmentRow, decryptPatientRow } = require('../utils/fieldEncryption');`
to `reportController.js`'s imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/reportController.nameSearchEncryption.test.js`
Expected: PASS (all cases, including the `getSessionAuditLog`/`generateAuditNJEIS` tests written in Step 1).

- [ ] **Step 5: Run the full existing reportController test suite to confirm no regression**

Run: `cd backend && npx jest src/controllers/__tests__/ -t "report"`
Expected: all pre-existing report-related tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/reportController.js backend/src/controllers/__tests__/reportController.nameSearchEncryption.test.js
git commit -m "Move Master Reports name search from SQL ILIKE to decrypt-then-filter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Remaining sort/display-only call sites — `billingController.js` ORDER BY sites, `patientDirectoryController.js`, and the display-only consumers

**IMPORTANT CORRECTION, found during this plan's self-review:** four of
the sites originally thought to sort child names actually sort
**practitioner** names, which are explicitly out of scope for this plan
(only `patients`/`assessments` child-identity columns are encrypted —
see Global Constraints). Verified by reading each site's actual SQL:

- `companyController.js:126` (`ORDER BY p.last_name, p.first_name`) — `p` is `practitioners` in the Access Roster query (`FROM practitioners p LEFT JOIN roles r ...`). **Out of scope, no change.**
- `dashboardController.js:129` (`ORDER BY p.first_name, p.last_name`) — `p` is `practitioners` in the "no activity in 7 days" query (`FROM practitioners p WHERE p.role = 'practitioner'`). **Out of scope, no change.**
- `messageController.js:57` (`ORDER BY last_msg.created_at DESC NULLS LAST, p.first_name ASC`) — `p` is `practitioners` (`WHERE p.role = 'practitioner'`); `created_at` isn't an encrypted column either. **Out of scope, no change.**
- `patientDirectoryController.js:22` (`ORDER BY pp.status ASC, p.last_name ASC`) — this is inside a `jsonb_agg(jsonb_build_object('id', p.id, 'first_name', p.first_name, ...))`, and `p` here is the joined `practitioners` table (the per-child list of attached practitioners), not the child. **The ORDER BY itself is out of scope** — but this same query's outer `SELECT pt.first_name, pt.middle_name, pt.last_name, pt.dob, ...` (line 17) selects real child-identity columns from `patients pt`, which DOES need decryption. This file stays in scope for a decrypt-only fix, with no sort change.

Only `billingController.js:1814,2417,2843` genuinely sort
`patient_first_name` (a real `assessments` column, confirmed by reading
each query in full — all three are plain `SELECT ... FROM assessments
... ORDER BY patient_first_name ASC, service_date ASC`, no join
aliasing confusion).

**Files:**
- Modify: `backend/src/controllers/billingController.js:1814,2417,2843` (`ORDER BY patient_first_name ASC, service_date ASC` — genuine child-name sort, needs app-side re-sort)
- Modify: `backend/src/controllers/patientDirectoryController.js:16-25` (`listDirectoryPatients` — decrypt `pt.first_name/middle_name/last_name/dob` on the returned rows; no sort change, the `ORDER BY` inside the `jsonb_agg` sorts practitioners, not this child)
- Modify: `backend/src/controllers/inspectionRequestController.js:71`, `backend/src/controllers/practitionerDashboardController.js:244`, `backend/src/controllers/scheduleController.js:158`, `backend/src/controllers/sessionDraftsController.js:100-112` (`listDrafts` — `SELECT ... p.first_name AS patient_first_name, p.last_name AS patient_last_name FROM session_drafts sd JOIN patients p`, found during this plan's self-review) (all display-only — `decryptAssessmentRow`/`decryptPatientRow` at the query site, no sort/filter logic to change)
- Modify: `backend/src/controllers/dashboardController.js:100,166` (two separate `pool.query` sites reading `a.patient_first_name`/`a.patient_last_name` directly from `assessments` — **this file runs its own direct queries, confirmed by reading it; it does NOT read already-decrypted data from another controller**, correcting an earlier wrong assumption in this plan's drafting)
- Modify: `backend/src/controllers/patientRecordExportController.js:431,823,962` (three separate `SELECT * FROM patients WHERE id = $1` / `SELECT id, first_name, last_name FROM patients` sites — **this is the Record of Access / full record-export feature, the single most FERPA/Part-C-compliance-critical export in the product; it was nearly missed by this plan's drafting because it was wrongly assumed to be covered elsewhere.** Without this fix, the parent-facing record-export PDF would show raw ciphertext instead of the child's name/DOB.)
- Modify: `backend/src/controllers/consentReportController.js:427` (`generateConsentReport`'s own `SELECT * FROM patients WHERE id = $1`, feeding `buildCoverRows({ patient, ... })` at line 99, the consent-scoped disclosure packet cover page — a **second** parent/recipient-facing compliance PDF found only on a fourth grep pass with a broader pattern (`\.dob\b` in addition to `patient_dob`), confirming this plan's earlier 4-term grep pattern was itself too narrow to catch every site.)
- No change needed: `backend/src/utils/agencyPractitionerSummary.js`, `backend/src/utils/invoiceData.js` — both are pure functions operating on rows their callers already fetched (confirmed by reading each file's header comment); their callers (`billingController.js`, `reportController.js`, `practitionerDashboardController.js`, `dashboardController.js` — all fixed in this task or earlier ones) now decrypt before calling in, so these two utilities receive already-decrypted plaintext automatically, with zero code changes of their own.
- Modify: `backend/src/controllers/billingController.js:2817` (practitioner-name `ILIKE` — confirmed `practitioners` table, NOT in scope, leave as-is, no change needed, included here only so the task's file list matches everywhere `dob`/name columns were found during the spec's full-repo grep)
- Test: `backend/src/controllers/__tests__/nameSortEncryption.test.js` (new file, covers the 3 confirmed billingController ORDER BY sites that need app-side re-sorting, plus one assertion each for the display-only sites)

**Interfaces:**
- Consumes: `decryptPatientRow`, `decryptAssessmentRow` from Task 2
- Produces: nothing consumed by later tasks (final call-site task before the full-repo verification task)

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/controllers/__tests__/nameSortEncryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');

function mockReqRes(query = {}, params = {}) {
  const req = { query, params, practitioner: { practitionerId: 1, slug: 'test' } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}
afterEach(() => jest.resetAllMocks());

describe('billingController pending-sessions list sort against encrypted patient_first_name', () => {
  it('getBillablePendingSessions-style queries return rows sorted by patient_first_name then service_date despite SQL no longer ordering by name', async () => {
    // Read billingController.js around line 1814 first to confirm the real
    // exported function name for this query (the one whose SQL currently
    // ends '... ORDER BY patient_first_name ASC, service_date ASC' and
    // selects from assessments scoped by startDate/endDate). Import it,
    // mock pool.query to return 2 rows with encrypted patient_first_name
    // in reverse alphabetical order and matching service_date values,
    // call the function, and assert the response's rows come back in
    // forward alphabetical order by (decrypted) patient_first_name.
  });

  it('the two other confirmed ORDER BY sites (lines 2417, 2843) show the same re-sort behavior', async () => {
    // Read billingController.js around lines 2417 and 2843 to find their
    // real exported function names (likely distinct from the line-1814
    // function — these are 3 separate code paths with the identical SQL
    // tail, not 3 calls to one shared function). Write one assertion per
    // function confirming decrypted, re-sorted output, mirroring the test
    // above exactly.
  });
});

describe('patientDirectoryController.listDirectoryPatients decrypts child identity without changing practitioner sort', () => {
  it('returns decrypted pt.first_name/middle_name/last_name/dob while the practitioners sub-array order is untouched', async () => {
    const { listDirectoryPatients } = require('../patientDirectoryController');
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        first_name: encryptField('Luz'), middle_name: encryptField('Marie'), last_name: encryptField('Quintero'), dob: encryptField('2024-03-05'),
        county: 'Essex', child_id: 'CH-100', created_at: new Date(), parent_name: 'Ana Quintero', parent_email: 'ana@example.com',
        practitioners: [{ id: 3, first_name: 'Omar', last_name: 'Abernathy', status: 'active', position_title: 'PT' }],
      }],
    });
    const { req, res } = mockReqRes();
    await listDirectoryPatients(req, res);
    const child = res.body.patients ? res.body.patients[0] : res.body[0]; // confirm the real response envelope by reading the file
    expect(child.first_name).toBe('Luz');
    expect(child.last_name).toBe('Quintero');
    expect(child.dob).toBe('2024-03-05');
    expect(child.practitioners[0].first_name).toBe('Omar'); // unchanged — practitioners stay plaintext, out of scope
  });
});

describe('patientRecordExportController decrypts patient rows before building the Record of Access PDF', () => {
  it('generateSingleChildInvoice decrypts the patient lookup and the assessment rows feeding the invoice', async () => {
    const { generateSingleChildInvoice } = require('../patientRecordExportController');
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero') }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), patient_dob: encryptField('2024-03-05'), billing_status: 'invoiced', total_time: 60, service_date: '2026-10-01', practitioners: {}, patients: {} }] });
    const req = { params: { id: '5' } };
    const res = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {}, send() {} };
    await generateSingleChildInvoice(req, res);
    // The real assertion here depends on whether this function sends a PDF
    // buffer or a JSON error — if it reaches PDF generation without
    // throwing on a decrypted child/assessment row, that is itself the
    // signal this fix worked (an undecrypted ciphertext name/dob fed into
    // pdf-lib's text-drawing would either throw or render garbage). Read
    // the function in full to confirm its success-path response shape and
    // assert against that, not against this sketch's placeholder res object.
    expect(res.statusCode).not.toBe(404);
  });

  it('exportPatientRecord decrypts the patient row before buildFullRecordPdf renders name/dob', async () => {
    const { exportPatientRecord } = require('../patientRecordExportController');
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), dob: encryptField('2024-03-05'), county: 'Essex' }],
    });
    const req = { params: { id: '5' } };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {}, send() {} };
    await exportPatientRecord(req, res);
    // Same note as above — confirm the real success-path shape (likely a
    // consent-gate redirect or a PDF buffer, not necessarily a plain JSON
    // response) by reading the function, and assert the decrypted name/dob
    // reached buildFullRecordPdf without a thrown error or a 404/500.
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).not.toBe(500);
  });
});

describe('consentReportController decrypts the patient row before the consent-scoped disclosure packet cover page', () => {
  it('generateConsentReport decrypts first_name/last_name/dob before buildCoverRows renders them', async () => {
    const { generateConsentReport } = require('../consentReportController');
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 7, revoked_at: null, expires_at: null }] }) // consent lookup
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), dob: encryptField('2024-03-05'), child_id: 'CH-100' }] }); // patient lookup
    const req = { params: { id: '5' } };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {}, send() {} };
    await generateConsentReport(req, res);
    // Read this function and sendConsentPacket in full first to confirm
    // the real success-path shape (likely a PDF buffer via res.send, not
    // JSON) — confirm no error/404/500 was returned, which is the
    // observable signal that buildCoverRows received decrypted plaintext
    // rather than throwing or rendering ciphertext.
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).not.toBe(500);
  });
});

describe('dashboardController decrypts patient_first_name/patient_last_name read directly from assessments', () => {
  it('returns decrypted names in the exceptions/flagged-sessions list (line ~100-144) and the second query (line ~166-202)', async () => {
    // Read dashboardController.js in full around both pool.query call
    // sites (today/exceptionRows/exceptionCountRows/noActivityRows near
    // line 93-131, and the second block near line 166-202) to confirm the
    // real exported function name(s) — these may be one function or two.
    // Mock pool.query to return encrypted patient_first_name/
    // patient_last_name at both sites, call the function(s), and assert
    // `patientName` in the response is decrypted plaintext, matching the
    // `${r.patient_first_name} ${r.patient_last_name}` concatenation
    // pattern already visible at lines 144 and 202.
  });
});

describe('display-only consumers decrypt without needing any sort/filter change', () => {
  it('inspectionRequestController returns decrypted patient_first_name/patient_last_name', async () => {
    // Read inspectionRequestController.js around line 71 to confirm the
    // real exported function name and the query at
    // `SELECT r.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name FROM (...)`.
    // Mock pool.query to return one row with those two fields encrypted,
    // call the function, assert the response contains the decrypted
    // plaintext values.
  });
  it('practitionerDashboardController returns decrypted patient_first_name/patient_last_name', async () => {
    // Read practitionerDashboardController.js around line 244
    // (`a.eims_missing_status, a.patient_first_name, a.patient_last_name`)
    // to confirm the real exported function name, then mirror the test
    // above exactly for this file's query/response shape.
  });
  it('scheduleController returns decrypted patient_first_name/patient_last_name', async () => {
    // Read scheduleController.js around line 158
    // (`SELECT s.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name`)
    // to confirm the real exported function name, then mirror the test
    // above exactly for this file's query/response shape.
  });
});
```

Every `it(...)` body above that is currently a comment must be filled in
with real assertions before this step is considered done — read each
named source file first (as each comment instructs), confirm its real
exported function name, query shape, and response envelope, then write
the same concrete assertion style used in the `billingController`/
`patientDirectoryController` examples that are already fully written
out above. A comment describing what to test is not a test; this is a
drafting shorthand for the plan document only, not something to carry
into the committed test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/nameSortEncryption.test.js`
Expected: FAIL — each site's SQL still has `ORDER BY ... first_name`/`last_name` against now-ciphertext columns (meaningless sort order) and/or returns ciphertext instead of decrypted plaintext in the response.

- [ ] **Step 3: Implement**

For the 3 confirmed `billingController.js` sites (lines 1814, 2417,
2843 — read the file to find each one's real enclosing function name,
since these are 3 separate functions, not 3 calls to one shared query),
apply the same two-part fix to each:

1. Remove `patient_first_name ASC` from the SQL `ORDER BY` clause,
   keeping `service_date ASC` (not an encrypted column, stays in SQL):
   `sql += ' ORDER BY service_date ASC';`
2. After `pool.query(...)` returns, map every row through
   `decryptAssessmentRow`, then `.sort()` in Node replicating the
   original compound sort key: `rows.sort((a, b) => (a.patient_first_name || '').localeCompare(b.patient_first_name || '') || (a.service_date || '').localeCompare(b.service_date || ''))`.

For `patientDirectoryController.js`'s `listDirectoryPatients` (lines
16-25), the query's own `ORDER BY` (inside the `jsonb_agg`) sorts
practitioners, not this child, and needs no change. Only add a decrypt
step on the outer `patients pt` fields after the query returns:

```javascript
    const { rows: rawPatients } = await pool.query(/* existing query, unchanged */);
    const patients = rawPatients.map(decryptPatientRow);
```

(`decryptPatientRow` strips `first_name_idx`/`last_name_idx` if present
on this row shape — this query doesn't currently select those columns,
so the strip is a harmless no-op here, not a required fix.)

For the 4 display-only controller sites (`inspectionRequestController.js:71`,
`practitionerDashboardController.js:244`, `scheduleController.js:158`,
`sessionDraftsController.js:104-112`), simply add a
`decryptAssessmentRow`/`decryptPatientRow` call on the relevant rows at
each query site — no sort logic to touch. `sessionDraftsController.js`'s
query selects `p.first_name AS patient_first_name, p.last_name AS
patient_last_name` from a `patients` join, so route it through
`decryptPatientRow` and rename the two fields in the mapped result to
match what `withSummary`/the response consumer expects (check the
existing `patient_first_name`/`patient_last_name` field names in the
response are preserved after the decrypt).

For `dashboardController.js`, add `decryptAssessmentRow` after each of
its two direct `pool.query` calls against `assessments`
(`exceptionRows` near line 100 and the second query near line 166),
before the `patientName: \`${r.patient_first_name || ''} ...\`` string
concatenation already present at lines 144/202.

For `patientRecordExportController.js`, add the decrypt call immediately
after each of its 3 `pool.query` sites, before the row is used further:
- Line 431 (`generateSingleChildInvoice`'s patient lookup): `const patient = decryptPatientRow(patientRows[0]);`
- Line 436 (`generateSingleChildInvoice`'s assessment rows feeding the invoice PDF): `const assessments = rawAssessments.map(decryptAssessmentRow);`
- Line 823 (`exportPatientRecord`): `const patient = decryptPatientRow(patientRows[0]);`
- Line 962 (the admin-override complete-record export): `const patient = decryptPatientRow(patientRows[0]);`

For `consentReportController.js`'s `generateConsentReport` (line 427),
add the same fix: `const patient = decryptPatientRow(patientRows[0]);`
immediately before it's passed into `sendConsentPacket({ patient, ... })`
at line 431. Add `const { decryptPatientRow } = require('../utils/fieldEncryption');`
to this file's imports.

This is the highest-priority fix in this task — it's the Record of
Access / parent-facing full-record-export feature, the product's most
FERPA/Part-C-compliance-critical export. Verify by actually running the
PDF-generation path in Step 4 below, not just checking that the
decrypt function was called.

No change needed for `backend/src/utils/agencyPractitionerSummary.js`,
`backend/src/utils/invoiceData.js` — confirmed pure functions, see Files
section above.

`companyController.js:126`, `dashboardController.js:129`, and
`messageController.js:57` need NO changes in this task — confirmed
above to sort `practitioners`, not `patients`/`assessments`.

Add the necessary `decryptPatientRow`/`decryptAssessmentRow` imports to
each of the 5 files actually modified
(`billingController.js` — likely already imported from Tasks 6-7, don't
duplicate the require; `patientDirectoryController.js`;
`inspectionRequestController.js`; `practitionerDashboardController.js`;
`scheduleController.js`; `agencyPractitionerSummary.js`; `invoiceData.js`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/nameSortEncryption.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Run the full existing test suite for every touched file to confirm no regression**

Run: `cd backend && npx jest`
Expected: full suite green except for files this plan has not yet reached (none should remain after this task — this is the last call-site task before final verification).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/patientDirectoryController.js backend/src/controllers/billingController.js backend/src/controllers/inspectionRequestController.js backend/src/controllers/practitionerDashboardController.js backend/src/controllers/scheduleController.js backend/src/controllers/sessionDraftsController.js backend/src/controllers/dashboardController.js backend/src/controllers/patientRecordExportController.js backend/src/controllers/consentReportController.js backend/src/controllers/__tests__/nameSortEncryption.test.js
git commit -m "Decrypt and re-sort remaining child-identity call sites

Includes the Record of Access / full-record-export feature
(patientRecordExportController.js) and dashboardController.js, both of
which run their own direct queries against assessments/patients rather
than reading already-decrypted data from another controller — an
earlier draft of this plan wrongly assumed otherwise.

companyController.js, dashboardController.js, and messageController.js
were checked and confirmed out of scope: their ORDER BY/name fields
belong to practitioners, not patients/assessments.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Test-data tooling fix (`testDataController.js` — all read AND write sites) plus `patientController.js`'s remaining sites, and final full-repo verification

**A second, more thorough read of `testDataController.js` during this
plan's self-review found 4 additional write sites beyond the 3
`LIKE '[GENSEPT26]%'` read sites originally scoped — all writing
plaintext child identity directly, same risk as `loadAgency.js`'s
seeding issue (Task 1):**
- Line 173: an UPDATE/INSERT param list `[c.firstName, c.lastName, c.dob, ...]`
- Lines 211-219: a seeding INSERT writing `patient_first_name, patient_last_name, patient_dob` plaintext
- Line 663: an anonymization UPDATE rewriting `assessments.patient_first_name/patient_last_name` to randomized fake names, plaintext
- Lines 1350-1357: a second seeding INSERT writing `patient_first_name, patient_last_name, patient_dob, session_notes` plaintext

**`patientController.js` also has 2 sites this plan's earlier tasks
missed** (Task 3 only covered `registerPatient`/`getPatients`/
`updatePatient`'s direct `patients` table reads/writes — these two are
`assessments` reads/writes in the same file):
- `getRejectedLogs` (~line 250-271): display-only `SELECT ... patient_first_name, patient_last_name ... FROM assessments`
- `editLog`/the date-change path (~line 401-467): writes `session_notes` on an `UPDATE assessments` — distinct from `createAssessment.js`/`dateChangeResign.js`, this is a third, separate `session_notes` write site in the codebase.

**Files:**
- Modify: `backend/src/controllers/testDataController.js:173,211-219,506,547,663,1350-1357,1417` (3 read sites — the `LIKE '[GENSEPT26]%'`/`GEN_TAG` tag matches — plus 4 write sites found on this second pass)
- Modify: `backend/src/controllers/patientController.js:250-271` (`getRejectedLogs`, display-only) and `:401-467` (`editLog`'s `session_notes` write, found on this second pass — read the function in full first to confirm its real exported name and the exact UPDATE statement, since the earlier line numbers from this plan's drafting may have shifted after Task 3's edits)
- Test: `backend/src/controllers/__tests__/testDataController.sessionNotesEncryption.test.js` (new file, covers all 7 testDataController sites)
- Test: `backend/src/controllers/__tests__/patientController.sessionNotesAndRejectedLogs.test.js` (new file, covers the 2 patientController sites)

**Interfaces:**
- Consumes: `decryptField`/`decryptAssessmentRow` from Task 2
- Produces: nothing — this is the final task.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/controllers/__tests__/testDataController.sessionNotesEncryption.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');

// Read testDataController.js around lines 506, 547, 1417 to find the real
// exported function name(s) that run the '[GENSEPT26]%' LIKE queries.
const { /* real exported function name(s) */ } = require('../testDataController');

afterEach(() => jest.resetAllMocks());

describe('test-data tooling tag matching against encrypted session_notes', () => {
  it('finds rows tagged [GENSEPT26] by decrypting and matching in Node, not via SQL LIKE', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, session_notes: encryptField('[GENSEPT26] auto-generated') },
        { id: 2, session_notes: encryptField('A real clinical note') },
      ],
    });
    // Call the real function, assert it finds only id 1, and assert the
    // SQL sent to pool.query no longer contains "LIKE '[GENSEPT26]%'"
    // (confirming the match moved from SQL to Node).
  });
});

describe('test-data seeding writes encrypted patient identity (lines 211-219, 1350-1357)', () => {
  it('stores first_name/last_name/dob/session_notes encrypted with a blind index set, for both seeding INSERTs', async () => {
    // Read testDataController.js around lines 160-225 and 1340-1360 to
    // confirm each seeding function's real exported name, then for each
    // one: mock pool.query, call the function with a minimal fixture,
    // capture the INSERT params, and assert (via decryptField) that the
    // stored first_name/last_name/dob/session_notes values round-trip to
    // the known plaintext fixture — same assertion style as Task 4's
    // createAssessment.encryption.test.js (reading column names out of
    // the SQL text to find each value's param index).
  });
});

describe('anonymization rename utility encrypts the new fake names it writes (line 653-666)', () => {
  it('stores the randomized replacement first_name/last_name encrypted on both patients and assessments, with a refreshed blind index', async () => {
    // Read testDataController.js around lines 630-670 to confirm the
    // real exported function name for this rename/anonymize utility.
    // Mock pool.query (or pool.connect, if it uses a transaction client —
    // check), call the function, and assert the UPDATE params for both
    // the patients UPDATE and the assessments UPDATE are ciphertext that
    // decrypts to the generated fake name, with first_name_idx/
    // last_name_idx populated to the matching hmacIndex() value.
  });
});
```

Every `it(...)` body above still phrased as a comment must be replaced
with a real, concrete test before this step is done, following the
exact assertion style already written out in full in Task 4's
`createAssessment.encryption.test.js` — read the real source file first
to get the real function name and SQL shape, as each comment
instructs.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/testDataController.sessionNotesEncryption.test.js`
Expected: FAIL — the SQL still contains the `LIKE '[GENSEPT26]%'` clause, which now matches against ciphertext and returns zero rows regardless of which rows are actually tagged.

- [ ] **Step 3: Implement the 3 read sites in `testDataController.js`**

For each of the 3 tag-matching sites (lines 506, 547, 1417), remove the
SQL `WHERE session_notes LIKE '[GENSEPT26]%'` (or `LIKE $1` with a
`GEN_TAG`-style parameter) clause (replace with whatever broader,
already-present scoping condition exists at that call site — e.g. a
company/date filter — or, if none exists, fetch all rows from the
relevant scope and filter in Node), decrypt `session_notes` via
`decryptField`, then filter for the tag in application code:

```javascript
const { rows: rawRows } = await pool.query(`SELECT id, session_notes FROM assessments`);
const tagged = rawRows
  .map((r) => ({ ...r, session_notes: decryptField(r.session_notes) }))
  .filter((r) => (r.session_notes || '').startsWith('[GENSEPT26]'));
```

Adjust each of the 3 sites individually to match its existing
surrounding logic (one of them also filters on `service_date IS NOT NULL`
per the spec's note — keep that condition, just move the tag match out
of SQL).

- [ ] **Step 4: Implement the 4 write sites in `testDataController.js`**

Read lines 160-225, 640-666, and 1340-1360 in full to confirm the exact
surrounding variable names and column-list arrays at each site (they
may have shifted slightly from the line numbers found during this
plan's drafting), then apply `encryptField()`/`hmacIndex()` the same way
as Task 1's `loadAgency.js` fix and Task 4's `createAssessment.js` fix:

- Line 173 and the two seeding INSERTs (lines 211-219, 1350-1357): wrap each of `firstName`/`lastName`/`dob` (or `first_name`/`last_name`/`dob` depending on the exact variable casing at that site) in `encryptField()`, wrap `session_notes` (where present, line 1353) in `encryptField()`, and add `patient_first_name_idx`/`patient_last_name_idx` (via `hmacIndex()`) to each INSERT's column list and params — mirror Task 1's `loadAgency.js` fix exactly, same pattern, different file.
- Line 653-666 (the anonymization rename utility): wrap the UPDATE's `r.newFirst`/`r.newLast` params in `encryptField()` for both the `patients` UPDATE (line 661) and the `assessments` UPDATE (line 663), and add `first_name_idx = $4, last_name_idx = $5` (and the `assessments` equivalent) to each UPDATE's SET clause with `hmacIndex(r.newFirst), hmacIndex(r.newLast)` appended to params.

Add `const { encryptField, decryptField, hmacIndex, decryptAssessmentRow } = require('../utils/fieldEncryption');`
to `testDataController.js`'s imports (combine into one require, don't
duplicate if a partial import already exists from Step 3).

- [ ] **Step 5: Fix `patientController.js`'s two remaining sites**

Read `getRejectedLogs` (~line 250-271) and the `editLog`/date-change
function (~line 401-467) in full to confirm their current exact line
numbers and exported names (Task 3's edits to this file may have
shifted them). For `getRejectedLogs`, decrypt the returned rows:

```javascript
    const { rows: rawLogs } = await pool.query(/* existing query, unchanged */);
    const logs = rawLogs.map(decryptAssessmentRow);
    res.json({ success: true, logs });
```

For the `editLog`/date-change function's `session_notes` write (the
`UPDATE assessments ... session_notes = $11` statement around line
462-467), wrap the value in `encryptField()`:

```javascript
       session_notes !== undefined ? (session_notes?.trim() ? encryptField(session_notes.trim()) : null) : log.session_notes,
```

(Note: `log.session_notes` on the "keep existing value" branch is
already ciphertext from the database — do NOT re-encrypt it, only the
new, freshly-typed `session_notes` from `req.body` needs
`encryptField()`.) Add `const { decryptAssessmentRow, encryptField } = require('../utils/fieldEncryption');`
to `patientController.js`'s imports (this file likely already imports
`encryptField`/`hmacIndex` from Task 3 — combine into one require, don't
duplicate).

- [ ] **Step 6: Run testDataController tests to verify they pass**

Run: `cd backend && npx jest src/controllers/__tests__/testDataController.sessionNotesEncryption.test.js`
Expected: PASS (all 3 describe blocks: tag-matching, seeding writes, anonymization rename).

- [ ] **Step 7: Write, then pass, the `patientController.js` test file**

```javascript
// backend/src/controllers/__tests__/patientController.sessionNotesAndRejectedLogs.test.js
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { encryptField, decryptField } = require('../../utils/fieldEncryption');
const { getRejectedLogs } = require('../patientController'); // confirm real name by reading the file

function mockReqRes(body = {}, params = {}) {
  const req = { body, params, practitioner: { practitionerId: 3 } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}
afterEach(() => jest.resetAllMocks());

describe('getRejectedLogs', () => {
  it('returns decrypted patient_first_name/patient_last_name', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), billing_status: 'rejected' }],
    });
    const { req, res } = mockReqRes();
    await getRejectedLogs(req, res);
    expect(res.body.logs[0].patient_first_name).toBe('Luz');
    expect(res.body.logs[0].patient_last_name).toBe('Quintero');
  });
});

describe("editLog's session_notes write", () => {
  it('encrypts a newly-typed session_notes value before storing it', async () => {
    // Read patientController.js's editLog/date-change function in full
    // (~line 401-467, confirm the real exported name) to get its exact
    // call shape, mock its ownership-check and UPDATE pool.query calls,
    // call it with a fresh session_notes string in the request body, and
    // assert the UPDATE's session_notes param decrypts back to that
    // string — mirroring Task 3's updatePatient test's approach of
    // locating the param by column position in the SQL text.
  });

  it('does not re-encrypt an already-encrypted session_notes value on the "keep existing" branch', async () => {
    // Drive the same function with session_notes omitted from the
    // request body (undefined), confirm the UPDATE param for
    // session_notes is passed through unchanged (still the original
    // ciphertext string, not double-encrypted) — this is the specific
    // correctness risk called out in Step 5's implementation note above.
  });
});
```

Run: `cd backend && npx jest src/controllers/__tests__/patientController.sessionNotesAndRejectedLogs.test.js`
Expected: PASS (3/3, once the two commented bodies above are filled in with real assertions).

- [ ] **Step 8: Run the full existing patientController and testDataController suites to confirm no regression**

Run: `cd backend && npx jest src/controllers/__tests__/ -t "patient" src/controllers/__tests__/ -t "testData"`
Expected: all pre-existing tests in both files still PASS.

- [ ] **Step 9: Final full-repo verification grep + full test suite**

Run the BROADER pattern, not the narrower 4-term one used while
drafting this plan — this plan's own drafting process twice missed real
sites (`consentReportController.js`, `patientRecordExportController.js`,
`dashboardController.js`) because an earlier pass used a grep pattern
too narrow to catch every `.dob` reference:
```bash
cd backend && grep -rln "\.dob\b\|patient_dob\|patient_first_name\|patient_last_name\|session_notes" src --include=*.js | grep -v "__tests__"
```
Expected output (26 files, confirmed exact at plan-writing time by
actually running this command):

```
src/config/tenantPoolRegistry.js        (comment only — documents the global date type-parser convention, no code change)
src/controllers/billingController.js    (fixed: Tasks 6, 7, 9)
src/controllers/companyController.js    (confirmed out of scope: line 474 is an Excel template column-label string, line 589 parses an uploaded cell value, not the stored column — see spec)
src/controllers/consentManageController.js        (fixed: Task 5)
src/controllers/consentReportController.js        (fixed: Task 9 — consent-scoped disclosure packet cover page, found on a 4th, broader grep pass)
src/controllers/consentSigningController.js       (fixed: Task 5)
src/controllers/dashboardController.js            (fixed: Task 9)
src/controllers/inspectionRequestController.js    (fixed: Task 9)
src/controllers/patientController.js              (fixed: Tasks 3, 10)
src/controllers/patientDirectoryController.js     (fixed: Task 9 — decrypt only, no sort change)
src/controllers/patientRecordExportController.js  (fixed: Task 9)
src/controllers/practitionerDashboardController.js (fixed: Task 9)
src/controllers/reportController.js               (fixed: Task 8)
src/controllers/scheduleController.js             (fixed: Task 9)
src/controllers/sessionDraftsController.js        (fixed: Task 9 — listDrafts' patients join)
src/controllers/telepracticeSignatureController.js (fixed: Task 5)
src/controllers/testDataController.js             (fixed: Task 10)
src/routes/patientRoutes.js                       (fixed: Task 7 — a 4th NJEIS-form-filling site, NOT routing-only as the filename suggests)
src/testdata/loadAgency.js                        (fixed: Task 1 — demo-agency seed INSERT now encrypts on write)
src/testdata/realisticAgency.js                   (confirmed no DB access of its own — pure in-memory fixture builder, `buildAgency`; its output is persisted by loadAgency.js, already fixed — no change needed here)
src/utils/agencyPractitionerSummary.js            (confirmed pure function, no change — see spec)
src/utils/createAssessment.js                     (fixed: Task 4)
src/utils/dateChangeResign.js                     (fixed: Task 4)
src/utils/invoiceData.js                          (confirmed pure function, no change — see spec)
src/utils/njeisFormFiller.js                       (confirmed no change needed — fix lives in billingController.js's query sites, Task 7)
src/utils/njeisGenerator.js                        (confirmed no change needed — same reasoning as njeisFormFiller.js; its only caller already covered)
```

If a file appears in the real command's output that is NOT on this
list, or a file listed above is missing, STOP: read that file now and
determine whether it's display-only (needs a decrypt call, low risk,
extend this task to cover it) or a comparison/parsing site (needs its
own task and test, same rigor as Tasks 5-7) before proceeding — do not
mark this task or the plan complete with an unexplained discrepancy
from this list.

Then run the complete backend test suite:
```bash
cd backend && npx jest
```
Expected: 100% pass, no new failures anywhere in the suite (not just the
files this plan touched) — this is the final gate, per Global
Constraints' requirement that every read path for these 7 columns is
accounted for.

- [ ] **Step 10: Commit**

```bash
git add backend/src/controllers/testDataController.js backend/src/controllers/patientController.js backend/src/controllers/__tests__/testDataController.sessionNotesEncryption.test.js backend/src/controllers/__tests__/patientController.sessionNotesAndRejectedLogs.test.js
git commit -m "Fix remaining testDataController and patientController sites

testDataController.js needed both the 3 originally-scoped read sites
(tag matching) and 4 write sites (seeding INSERTs, an anonymization
UPDATE) found on a closer second read. patientController.js needed 2
more sites (getRejectedLogs, editLog's session_notes write) beyond
Task 3's registerPatient/getPatients/updatePatient.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
