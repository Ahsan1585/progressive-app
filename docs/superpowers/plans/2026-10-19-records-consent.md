# Records Consent & Disclosure Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close FERPA/IDEA Part C compliance gap #1 — require and enforce parental consent before an independent practitioner emails a child's SEVF/invoice to a billing agency, the one real third-party disclosure point in the app today.

**Architecture:** A new `records_consents` table (one row per consent grant, free-text recipient, fixed record-type set, expiration, revocation) with a thin `checkConsent()` helper in a new `backend/src/utils/recordsConsent.js`. `emailSevfToAgency` calls that helper before sending and is hard-blocked on failure. CRUD lives in a new `recordsConsentController.js`, routed as nested sub-resources of `patientRoutes.js` (matching the existing `/:id/agencies` pattern). Mobile gets a new `Consents` section on the patient detail screen and an error-surfacing tweak in the agency-email dialog.

**Tech Stack:** Node/Express/PostgreSQL backend (existing `pool.query` pattern, no ORM); React/TypeScript mobile app (existing `@/api/axiosInstance`, shadcn-style `ui/*` components, `useToast`).

**Spec:** `docs/superpowers/specs/2026-10-19-records-consent-design.md`

## Global Constraints

- `record_types` values are exactly `'session_logs'`, `'sevf_forms'`, `'invoices'`, `'full_record_export'` — no others, enforced by a CHECK constraint.
- `expires_at` defaults to `granted_at + interval '1 year'` but is always an explicit, editable column (never computed at read time).
- A consent is "active" (usable to pass a gate) iff `revoked_at IS NULL AND expires_at > now()`. Never delete a consent row — revoke sets `revoked_at`/`revoked_by`.
- Recipient matching for the consent gate is case-insensitive exact match on `recipient_name` (`lower(recipient_name) = lower($x)`), never fuzzy/partial matching.
- Every new ownership-scoped query on `patient_practitioners` must include `AND pp.deactivated_reason IS DISTINCT FROM 'reassigned'`, matching the pattern already shipped across the rest of the codebase (see `backend/src/controllers/patientController.js:117`).
- This feature is independent-practitioner-only: every new route uses `protect, requireRole(['independent_practitioner'])`, no `loadPermissions`/`requirePermission` (that permission system doesn't apply to this role — confirm via the existing `/:id/agencies` routes in `patientRoutes.js:81-82`).
- Mobile has no automated test infrastructure in this repo (confirmed during design investigation) — mobile tasks are verified by `npm run build`/typecheck plus a manual walkthrough description in the task, not new test files.

## Review Focus

- A practitioner with an active consent for the right child but the WRONG recipient (consent on file for "ABC Billing", send targets "XYZ Agency") — must still block. The gate is per-(patient, recipient), not "does this child have any active consent at all."
- A consent whose `expires_at` is exactly `now()` at send time — must block (`expires_at > now()`, not `>=`).
- A revoked consent followed by a brand-new consent for the same (patient, recipient) — the new row must pass the gate; the revoked row must never be resurrected or counted.
- `invoiceBuffer` is `null` (batch has no invoice path yet) — the gate must require only `'sevf_forms'` consent, not `'invoices'` too, since nothing invoice-shaped is actually being sent.
- Recipient name differing only by case or surrounding whitespace ("ABC Billing" vs " abc billing") — must still match (case-insensitive, and the comparison value is trimmed before the query).

---

### Task 1: `records_consents` table + migration

**Files:**
- Create: `backend/db/migrations/add_records_consents.sql`
- Modify: `backend/db/migrations/index.js`

**Interfaces:**
- Produces: the `records_consents` table, columns exactly as below. Every later task reads/writes this table directly via `pool.query`.

- [ ] **Step 1: Write the migration file**

```sql
-- backend/db/migrations/add_records_consents.sql
--
-- FERPA/IDEA Part C §99.30 & §303.414 — prior written parental consent is
-- required before disclosing a child's records to a third party outside
-- the Part C system. One row per consent grant: which records, for what
-- purpose, to which specific recipient, with revocation and expiration.
-- See docs/superpowers/specs/2026-10-19-records-consent-design.md.
CREATE TABLE IF NOT EXISTS records_consents (
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
  proof_note text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_consents_record_types_check'
  ) THEN
    ALTER TABLE records_consents ADD CONSTRAINT records_consents_record_types_check
      CHECK (record_types <@ ARRAY['session_logs','sevf_forms','invoices','full_record_export']::text[]);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_consents_record_types_nonempty_check'
  ) THEN
    ALTER TABLE records_consents ADD CONSTRAINT records_consents_record_types_nonempty_check
      CHECK (cardinality(record_types) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS records_consents_patient_id_idx ON records_consents (patient_id);
```

- [ ] **Step 2: Register the migration**

Add `'add_records_consents.sql',` as the last entry in the `MIGRATIONS` array in `backend/db/migrations/index.js` (append after whatever is currently last — do not reorder existing entries).

- [ ] **Step 3: Verify the migration file is syntactically valid SQL**

Run: `node -e "require('fs').readFileSync('backend/db/migrations/add_records_consents.sql', 'utf8')"`
Expected: no output, exit code 0 (this just confirms the file exists and is readable; the real correctness check is the next task's tests actually inserting/querying rows through this schema once the migration is applied to the local dev DB — if you have one. If no local Postgres is available, trust the SQL and let Task 2's mocked tests catch logic errors instead.)

- [ ] **Step 4: Commit**

```bash
git add backend/db/migrations/add_records_consents.sql backend/db/migrations/index.js
git commit -m "Add records_consents table migration"
```

---

### Task 2: `checkConsent` enforcement helper

**Files:**
- Create: `backend/src/utils/recordsConsent.js`
- Test: `backend/src/utils/__tests__/recordsConsent.test.js`

**Interfaces:**
- Consumes: `pool` from `../config/db` (mocked in tests the same way every other controller test in this repo mocks it — see `backend/src/controllers/__tests__/patientController.access.test.js` for the pattern: `jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));`).
- Produces: `async function checkConsent(patientId, recipientName, recordTypes)` → `Promise<{ ok: true, consentId: number } | { ok: false, reason: string }>`. `recordTypes` is a plain JS array of strings (subset of the 4 valid values). Later tasks (Task 3's route handlers, Task 4's `emailSevfToAgency` gate) call this exact function with these exact argument types.

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/utils/__tests__/recordsConsent.test.js
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { checkConsent } = require('../recordsConsent');

describe('checkConsent', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns ok:true with the consent id when an active matching consent exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });

    const result = await checkConsent(10, 'ABC Billing', ['sevf_forms']);

    expect(result).toEqual({ ok: true, consentId: 42 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('lower(recipient_name) = lower($2)'),
      [10, 'ABC Billing', ['sevf_forms']]
    );
  });

  test('returns ok:false when no matching consent exists at all', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await checkConsent(10, 'ABC Billing', ['sevf_forms']);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('No consent on file');
  });

  test('query excludes revoked and expired consents, and requires every record type covered', async () => {
    // We don't fake the DB's own revocation/expiration logic here — we
    // assert the SQL text includes the WHERE clauses that encode it,
    // since the real enforcement runs inside Postgres (revoked_at IS NULL,
    // expires_at > now(), record_types @> the requested set).
    pool.query.mockResolvedValueOnce({ rows: [] });

    await checkConsent(10, 'ABC Billing', ['sevf_forms', 'invoices']);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at > now()');
    expect(sql).toContain('record_types @>');
    expect(params).toEqual([10, 'ABC Billing', ['sevf_forms', 'invoices']]);
  });

  test('trims the recipient name before matching', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 7 }] });

    await checkConsent(10, '  ABC Billing  ', ['sevf_forms']);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [10, 'ABC Billing', ['sevf_forms']]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest recordsConsent.test.js`
Expected: FAIL — `Cannot find module '../recordsConsent'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/utils/recordsConsent.js
const { pool } = require('../config/db');

// FERPA/IDEA Part C §99.30 & §303.414 enforcement — a consent is usable to
// authorize a disclosure only when it is not revoked, not expired, matches
// the recipient (case-insensitive exact match — never fuzzy, an exact
// intentional recipient is what the regulation requires), and covers every
// record type actually being disclosed (record_types @> the requested
// array, so a consent scoped to ['sevf_forms'] does NOT satisfy a request
// for ['sevf_forms', 'invoices']). record_types IS NULL FOR no matching row
// at all is handled the same as "none of the above matched" — both read as
// ok:false, since the caller only needs to know whether it's safe to send.
async function checkConsent(patientId, recipientName, recordTypes) {
  const trimmedRecipient = String(recipientName).trim();
  const { rows } = await pool.query(
    `SELECT id FROM records_consents
     WHERE patient_id = $1
       AND lower(recipient_name) = lower($2)
       AND revoked_at IS NULL
       AND expires_at > now()
       AND record_types @> $3::text[]
     ORDER BY granted_at DESC
     LIMIT 1`,
    [patientId, trimmedRecipient, recordTypes]
  );
  if (rows[0]) return { ok: true, consentId: rows[0].id };
  return {
    ok: false,
    reason: `No consent on file for "${trimmedRecipient}" covering ${recordTypes.join(', ')} for this child — log one on the child's Consents screen before sending.`,
  };
}

module.exports = { checkConsent };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest recordsConsent.test.js`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/recordsConsent.js backend/src/utils/__tests__/recordsConsent.test.js
git commit -m "Add checkConsent enforcement helper for records_consents"
```

---

### Task 3: Consent CRUD controller + routes

**Files:**
- Create: `backend/src/controllers/recordsConsentController.js`
- Test: `backend/src/controllers/__tests__/recordsConsentController.test.js`
- Modify: `backend/src/routes/patientRoutes.js`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (this task's own `pool.query` calls write/read `records_consents` from Task 1's schema; it does not call Task 2's `checkConsent`, which is purely a read-time gate used by Task 4).
- Produces: `listPatientConsents`, `createConsent`, `revokeConsent` — all `(req, res)` Express handlers, exported from `recordsConsentController.js`. Task 4 does not consume these; they're wired directly into routes in this task.

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/controllers/__tests__/recordsConsentController.test.js
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { listPatientConsents, createConsent, revokeConsent } = require('../recordsConsentController');

describe('listPatientConsents', () => {
  afterEach(() => jest.clearAllMocks());

  test('checks ownership (excluding reassigned-away patients) before listing', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await listPatientConsents(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      ['42', 7]
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns the patient\'s consents, newest first, when owned', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const consentRows = [{ id: 2, recipient_name: 'ABC', granted_at: '2026-10-01' }];
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // ownership check passes
      .mockResolvedValueOnce({ rows: consentRows }); // SELECT consents

    await listPatientConsents(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, consents: consentRows });
  });
});

describe('createConsent', () => {
  afterEach(() => jest.clearAllMocks());

  test('rejects an invalid record_types value with 400 before touching the DB', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      params: { id: '42' },
      body: { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['not_a_real_type'] },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await createConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects an empty record_types array with 400', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      params: { id: '42' },
      body: { recipientName: 'ABC', purpose: 'Billing', recordTypes: [] },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await createConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('checks ownership before creating', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      params: { id: '42' },
      body: { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['sevf_forms'] },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await createConsent(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      ['42', 7]
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('defaults expires_at to one year from now when not supplied', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      params: { id: '42' },
      body: { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['sevf_forms'] },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // ownership check passes
      .mockResolvedValueOnce({ rows: [{ id: 5, expires_at: '2027-10-19T00:00:00.000Z' }] }); // INSERT

    await createConsent(req, res);

    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO records_consents');
    // 6th bind param is expires_at (patient_id, recipient_name, purpose,
    // record_types, granted_by, expires_at, proof_note) — when the caller
    // doesn't supply one, the handler computes granted_at + 1 year itself
    // rather than relying on a DB default, so it's always a concrete value
    // in the audit trail regardless of what the row's default would be.
    expect(insertCall[1][5]).toEqual(expect.any(Date));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('revokeConsent', () => {
  afterEach(() => jest.clearAllMocks());

  test('checks ownership before revoking', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42', consentId: '5' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await revokeConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('sets revoked_at/revoked_by on the matching consent', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42', consentId: '5' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // ownership check passes
      .mockResolvedValueOnce({ rows: [{ id: '5' }] }); // UPDATE ... RETURNING id

    await revokeConsent(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SET revoked_at = now(), revoked_by = $1'),
      [7, '5', '42']
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('404s when the consentId does not belong to this patient', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42', consentId: '999' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // ownership check passes
      .mockResolvedValueOnce({ rows: [] }); // UPDATE matches nothing

    await revokeConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest recordsConsentController.test.js`
Expected: FAIL — `Cannot find module '../recordsConsentController'`.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/controllers/recordsConsentController.js
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');

const VALID_RECORD_TYPES = ['session_logs', 'sevf_forms', 'invoices', 'full_record_export'];

// Same ownership-scoping pattern as every other per-patient endpoint
// (patientController.js's getPatients/updatePatient/getPatientAssessments)
// — a consent record is as sensitive as any other patient data, and
// deactivated_reason = 'reassigned' means this practitioner is no longer
// this child's assigned provider (FERPA/IDEA Part C §303.404), so their
// access to even VIEW consent records for that child must end immediately.
async function assertOwnsPatient(patientId, practitionerId) {
  const { rows } = await pool.query(
    "SELECT p.id FROM patients p JOIN patient_practitioners pp ON pp.patient_id = p.id WHERE p.id = $1 AND pp.practitioner_id = $2 AND pp.deactivated_reason IS DISTINCT FROM 'reassigned'",
    [patientId, practitionerId]
  );
  return !!rows[0];
}

const listPatientConsents = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  try {
    if (!(await assertOwnsPatient(id, practitionerId))) {
      return res.status(404).json({ success: false, error: 'Patient not found.' });
    }
    const { rows: consents } = await pool.query(
      'SELECT * FROM records_consents WHERE patient_id = $1 ORDER BY granted_at DESC',
      [id]
    );
    res.json({ success: true, consents });
  } catch (error) {
    console.error('Error listing consents:', error);
    res.status(500).json({ success: false, error: 'Failed to load consents.' });
  }
};

const createConsent = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  const { recipientName, purpose, recordTypes, expiresAt, proofNote } = req.body;

  if (!recipientName || !String(recipientName).trim()) {
    return res.status(400).json({ success: false, error: 'recipientName is required.' });
  }
  if (!purpose || !String(purpose).trim()) {
    return res.status(400).json({ success: false, error: 'purpose is required.' });
  }
  if (!Array.isArray(recordTypes) || recordTypes.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one record type is required.' });
  }
  const invalidTypes = recordTypes.filter((t) => !VALID_RECORD_TYPES.includes(t));
  if (invalidTypes.length > 0) {
    return res.status(400).json({ success: false, error: `Invalid record type(s): ${invalidTypes.join(', ')}` });
  }

  try {
    if (!(await assertOwnsPatient(id, practitionerId))) {
      return res.status(404).json({ success: false, error: 'Patient not found.' });
    }

    // Always a concrete Date computed here (not left to a DB column
    // default) so the exact expiration is known and loggable regardless
    // of what the schema's own default happens to be.
    const resolvedExpiresAt = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const { rows } = await pool.query(
      `INSERT INTO records_consents (patient_id, recipient_name, purpose, record_types, granted_by, expires_at, proof_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, String(recipientName).trim(), String(purpose).trim(), recordTypes, practitionerId, resolvedExpiresAt, proofNote || null]
    );
    const consent = rows[0];

    logAudit({
      req, action: 'records_consent_granted', resourceType: 'patient', resourceId: id,
      details: { consentId: consent.id, recipientName: consent.recipient_name, recordTypes: consent.record_types },
    });

    res.status(201).json({ success: true, consent });
  } catch (error) {
    console.error('Error creating consent:', error);
    res.status(500).json({ success: false, error: 'Failed to create consent.' });
  }
};

const revokeConsent = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id, consentId } = req.params;
  try {
    if (!(await assertOwnsPatient(id, practitionerId))) {
      return res.status(404).json({ success: false, error: 'Patient not found.' });
    }
    const { rows } = await pool.query(
      'UPDATE records_consents SET revoked_at = now(), revoked_by = $1 WHERE id = $2 AND patient_id = $3 AND revoked_at IS NULL RETURNING id',
      [practitionerId, consentId, id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Consent not found.' });

    logAudit({
      req, action: 'records_consent_revoked', resourceType: 'patient', resourceId: id,
      details: { consentId: rows[0].id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking consent:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke consent.' });
  }
};

module.exports = { listPatientConsents, createConsent, revokeConsent };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest recordsConsentController.test.js`
Expected: PASS — 9/9 tests.

- [ ] **Step 5: Wire the routes**

In `backend/src/routes/patientRoutes.js`, add the import alongside the existing `getPatientAgencies, updatePatientAgencies` import line:

```javascript
const { listPatientConsents, createConsent, revokeConsent } = require('../controllers/recordsConsentController');
```

Add these three routes directly below the existing `/:id/agencies` routes (same guard pattern):

```javascript
router.get('/:id/consents', protect, requireRole(['independent_practitioner']), listPatientConsents);
router.post('/:id/consents', protect, requireRole(['independent_practitioner']), createConsent);
router.delete('/:id/consents/:consentId', protect, requireRole(['independent_practitioner']), revokeConsent);
```

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && npx jest`
Expected: all suites pass (no regressions in any existing controller).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/recordsConsentController.js backend/src/controllers/__tests__/recordsConsentController.test.js backend/src/routes/patientRoutes.js
git commit -m "Add records consent CRUD controller and routes"
```

---

### Task 4: Gate `emailSevfToAgency` on consent

**Files:**
- Modify: `backend/src/controllers/billingController.js`
- Test: `backend/src/controllers/__tests__/emailSevfToAgency.consent.test.js`

**Interfaces:**
- Consumes: `checkConsent(patientId, recipientName, recordTypes)` from `../utils/recordsConsent` (Task 2) — exact signature and return shape as implemented there.
- Produces: nothing new consumed by later tasks; this is the terminal enforcement point.

- [ ] **Step 1: Read the current `emailSevfToAgency` implementation**

Re-read `backend/src/controllers/billingController.js` around `emailSevfToAgency` (search for `const emailSevfToAgency = async`) to confirm line numbers haven't shifted since this plan was written, before editing.

- [ ] **Step 2: Write the failing tests**

```javascript
// backend/src/controllers/__tests__/emailSevfToAgency.consent.test.js
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/storage', () => ({
  BILLING_INVOICES_BUCKET: 'test-bucket',
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));
jest.mock('../../utils/emailClient', () => ({ sendSevfToAgencyEmail: jest.fn().mockResolvedValue() }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/recordsConsent', () => ({ checkConsent: jest.fn() }));

const { pool } = require('../../config/db');
const { sendSevfToAgencyEmail } = require('../../utils/emailClient');
const { checkConsent } = require('../../utils/recordsConsent');
const { emailSevfToAgency } = require('../billingController');

describe('emailSevfToAgency consent gate', () => {
  afterEach(() => jest.clearAllMocks());

  const baseReq = () => ({
    practitioner: { practitionerId: 7 },
    body: { batchId: 'batch-uuid-1', agencyEmail: 'billing@abc.org' },
  });

  function mockBatchLookup({ patientId = 10, companyAffiliation = 'ABC Billing', njeisPath = 'sevf.pdf', invoicePath = null } = {}) {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'batch-uuid-1', njeis_path: njeisPath, invoice_path: invoicePath,
        first_name: 'Jane', last_name: 'Doe', patient_id: patientId, company_affiliation: companyAffiliation,
      }],
    });
  }

  test('blocks the send and returns 400 when checkConsent reports ok:false', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup();
    checkConsent.mockResolvedValueOnce({ ok: false, reason: 'No consent on file for "ABC Billing" covering sevf_forms for this child.' });

    await emailSevfToAgency(req, res);

    expect(checkConsent).toHaveBeenCalledWith(10, 'ABC Billing', ['sevf_forms']);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringContaining('No consent on file'),
    }));
    expect(sendSevfToAgencyEmail).not.toHaveBeenCalled();
  });

  test('requires invoices consent too when an invoice is attached', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup({ invoicePath: 'invoice.pdf' });
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 99 });

    await emailSevfToAgency(req, res);

    expect(checkConsent).toHaveBeenCalledWith(10, 'ABC Billing', ['sevf_forms', 'invoices']);
  });

  test('sends and logs the consentId when checkConsent reports ok:true', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup();
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 42 });
    const { logAudit } = require('../../utils/auditLog');

    await emailSevfToAgency(req, res);

    expect(sendSevfToAgencyEmail).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sevf_emailed_to_agency',
      details: expect.objectContaining({ consentId: 42 }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('falls back to the raw agency email as the recipient name when company_affiliation is null', async () => {
    const req = baseReq();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockBatchLookup({ companyAffiliation: null });
    checkConsent.mockResolvedValueOnce({ ok: true, consentId: 1 });

    await emailSevfToAgency(req, res);

    expect(checkConsent).toHaveBeenCalledWith(10, 'billing@abc.org', ['sevf_forms']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx jest emailSevfToAgency.consent.test.js`
Expected: FAIL — the consent gate doesn't exist yet, so `checkConsent` is never called (`expect(checkConsent).toHaveBeenCalledWith(...)` fails) and the send proceeds instead of blocking.

- [ ] **Step 4: Implement the gate**

In `backend/src/controllers/billingController.js`, add the import near the other `require` statements at the top of the file (alongside the existing `const { ... } = require('../utils/...')` lines):

```javascript
const { checkConsent } = require('../utils/recordsConsent');
```

Modify the batch lookup query inside `emailSevfToAgency` to also pull the patient and recipient-name info, and insert the gate before `sendSevfToAgencyEmail` is called:

```javascript
const emailSevfToAgency = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { batchId, agencyEmail } = req.body;

  if (!batchId || !agencyEmail || !String(agencyEmail).trim()) {
    return res.status(400).json({ success: false, error: 'batchId and agencyEmail are required.' });
  }

  try {
    // Every assessment in one of these batches shares a single patient —
    // generateSelfCertifiedSEVF groups strictly by (patient, affiliation,
    // month) — so LIMIT 1 on the join is sufficient to resolve the one
    // patient_id/company_affiliation this batch belongs to.
    const { rows } = await pool.query(
      `SELECT b.id, b.njeis_path, b.invoice_path, p.first_name, p.last_name,
              a.patient_id, a.company_affiliation
       FROM billing_batches b
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN assessments a ON a.billing_batch_id = b.id
       WHERE b.id = $1 AND b.practitioner_id = $2
       LIMIT 1`,
      [batchId, practitionerId]
    );
    const batch = rows[0];
    if (!batch) return res.status(404).json({ success: false, error: 'SEVF batch not found.' });
    if (!batch.njeis_path) return res.status(400).json({ success: false, error: 'This batch has no SEVF on file.' });

    const trimmedAgencyEmail = String(agencyEmail).trim();
    const recipientName = batch.company_affiliation || trimmedAgencyEmail;
    const recordTypes = batch.invoice_path ? ['sevf_forms', 'invoices'] : ['sevf_forms'];

    const consentResult = await checkConsent(batch.patient_id, recipientName, recordTypes);
    if (!consentResult.ok) {
      return res.status(400).json({ success: false, error: consentResult.reason, code: 'CONSENT_REQUIRED' });
    }

    const pdfBuffer = await downloadFile(BILLING_INVOICES_BUCKET, batch.njeis_path);
    const practitionerName = `${batch.first_name} ${batch.last_name}`.trim();

    const invoiceBuffer = batch.invoice_path
      ? await downloadFile(BILLING_INVOICES_BUCKET, batch.invoice_path)
      : null;

    await sendSevfToAgencyEmail(trimmedAgencyEmail, {
      practitionerName,
      pdfBuffer,
      pdfFilename: path.basename(batch.njeis_path),
      invoiceBuffer,
      invoiceFilename: batch.invoice_path ? path.basename(batch.invoice_path) : undefined,
    });

    logAudit({
      req, action: 'sevf_emailed_to_agency', resourceType: 'billing_batch', resourceId: batchId,
      details: { agencyEmail: trimmedAgencyEmail, includedInvoice: !!invoiceBuffer, consentId: consentResult.consentId },
    });

    res.json({ success: true, message: invoiceBuffer ? 'SEVF and invoice emailed to the agency.' : 'SEVF emailed to the agency.' });
  } catch (error) {
    console.error('Error emailing SEVF to agency:', error);
    res.status(500).json({ success: false, error: 'Failed to email SEVF.' });
  }
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest emailSevfToAgency.consent.test.js`
Expected: PASS — 4/4 tests.

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && npx jest`
Expected: all suites pass, including the pre-existing `emailSevfToAgency`-adjacent tests if any exist (search first: `grep -rl emailSevfToAgency backend/src/controllers/__tests__/` — if a prior test file already covers the happy path without consent, verify it still passes now that `checkConsent` is a hard dependency; it will need `jest.mock('../../utils/recordsConsent', ...)` added if it doesn't already mock it, since the real implementation would otherwise hit a real, unmocked `pool.query` call and throw).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/billingController.js backend/src/controllers/__tests__/emailSevfToAgency.consent.test.js
git commit -m "Gate emailSevfToAgency on records consent"
```

---

### Task 5: Mobile — Consents section on the patient detail screen

**Files:**
- Create: `mobile/src/components/PatientConsents.tsx`
- Modify: `mobile/src/pages/PatientDetail.tsx`
- Modify: `mobile/src/types/index.ts`

**Interfaces:**
- Consumes: `GET /api/patients/:id/consents` → `{ success: true, consents: RecordsConsent[] }`; `POST /api/patients/:id/consents` with body `{ recipientName, purpose, recordTypes, expiresAt?, proofNote? }` → `{ success: true, consent: RecordsConsent }` or `400`/`404` with `{ success: false, error: string }`; `DELETE /api/patients/:id/consents/:consentId` → `{ success: true }` or `404`. All three routes and shapes are exactly as implemented in Task 3.
- Produces: the `PatientConsents` component, imported and rendered by `PatientDetail.tsx`. No later task consumes this component directly (Task 6 only touches `SevfHistory.tsx`), but both tasks rely on the same `RecordsConsent` type added here.

- [ ] **Step 1: Add the `RecordsConsent` type**

In `mobile/src/types/index.ts`, add (near `GeneratedSevfResult`, which this type is conceptually adjacent to):

```typescript
export type RecordType = 'session_logs' | 'sevf_forms' | 'invoices' | 'full_record_export';

export interface RecordsConsent {
  id: number;
  patient_id: number;
  recipient_name: string;
  purpose: string;
  record_types: RecordType[];
  granted_by: number;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
  proof_note: string | null;
}
```

- [ ] **Step 2: Build the `PatientConsents` component**

```tsx
// mobile/src/components/PatientConsents.tsx
import * as React from "react";
import { ShieldCheck, Plus } from "lucide-react";
import api from "@/api/axiosInstance";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import type { RecordsConsent, RecordType, ApiErrorBody } from "@/types";

const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  session_logs: "Session logs",
  sevf_forms: "SEVF forms",
  invoices: "Invoices",
  full_record_export: "Full record export",
};

function consentStatus(c: RecordsConsent): "Active" | "Revoked" | "Expired" {
  if (c.revoked_at) return "Revoked";
  if (new Date(c.expires_at) <= new Date()) return "Expired";
  return "Active";
}

interface PatientConsentsProps {
  // string, matching Patient.id's type (mobile/src/types/index.ts) — the
  // caller (PatientDetail.tsx) has a Patient, not a GeneratedSevfResult
  // (whose patientId is a number), so this takes the same type its one
  // real caller already has, instead of forcing a conversion.
  patientId: string;
}

// FERPA/IDEA Part C §99.30 & §303.414 — before emailing a child's SEVF to a
// billing agency (see SevfHistory.tsx), a matching, active consent must be
// on file here or the backend refuses the send. Staff-logged only: a
// practitioner records that a parent gave consent (verbally, on paper, or
// some other out-of-band means), not a parent-facing self-service flow.
export function PatientConsents({ patientId }: PatientConsentsProps) {
  const { showToast } = useToast();
  const [consents, setConsents] = React.useState<RecordsConsent[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [formOpen, setFormOpen] = React.useState(false);
  const [recipientName, setRecipientName] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [selectedTypes, setSelectedTypes] = React.useState<RecordType[]>([]);
  const [proofNote, setProofNote] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<RecordsConsent | null>(null);
  const [isRevoking, setIsRevoking] = React.useState(false);

  const fetchConsents = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ success: boolean; consents: RecordsConsent[] }>(
        `/api/patients/${patientId}/consents`
      );
      setConsents(res.data.consents || []);
    } catch {
      showToast("Couldn't load consents.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [patientId, showToast]);

  React.useEffect(() => {
    fetchConsents();
  }, [fetchConsents]);

  const toggleType = (t: RecordType) => {
    setSelectedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const resetForm = () => {
    setRecipientName("");
    setPurpose("");
    setSelectedTypes([]);
    setProofNote("");
  };

  const commitNew = async () => {
    if (!recipientName.trim() || !purpose.trim() || selectedTypes.length === 0) return;
    setIsSaving(true);
    try {
      await api.post(`/api/patients/${patientId}/consents`, {
        recipientName: recipientName.trim(),
        purpose: purpose.trim(),
        recordTypes: selectedTypes,
        proofNote: proofNote.trim() || undefined,
      });
      setFormOpen(false);
      resetForm();
      fetchConsents();
      showToast("Consent logged.", "success");
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      showToast(body?.error || "Couldn't log this consent.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const commitRevoke = async () => {
    if (!revokeTarget) return;
    setIsRevoking(true);
    try {
      await api.delete(`/api/patients/${patientId}/consents/${revokeTarget.id}`);
      setRevokeTarget(null);
      fetchConsents();
      showToast("Consent revoked.", "success");
    } catch {
      showToast("Couldn't revoke this consent.", "error");
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Consents
        </h3>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="press-scale flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-3 py-1 text-xs font-semibold text-primary"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Log consent
        </button>
      </div>

      {isLoading ? (
        <p className="mt-2 text-xs text-ink-muted">Loading…</p>
      ) : consents.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">No consents on file for this child yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {consents.map((c) => {
            const status = consentStatus(c);
            return (
              <li key={c.id} className="rounded-control border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">{c.recipient_name}</span>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                      (status === "Active"
                        ? "bg-emerald-50 text-emerald-700"
                        : status === "Expired"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-500")
                    }
                  >
                    {status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">{c.purpose}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {c.record_types.map((t) => RECORD_TYPE_LABELS[t]).join(", ")}
                </p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  Granted {new Date(c.granted_at).toLocaleDateString()} · Expires {new Date(c.expires_at).toLocaleDateString()}
                </p>
                {status === "Active" && (
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(c)}
                    className="press-scale mt-2 text-xs font-semibold text-red-600"
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent aria-labelledby="log-consent-title">
          <SheetHeader>
            <SheetTitle id="log-consent-title">Log a new consent</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="consent-recipient">Recipient</Label>
            <Input
              id="consent-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="e.g. ABC Billing Agency"
              disabled={isSaving}
            />
            <Label htmlFor="consent-purpose">Purpose</Label>
            <Input
              id="consent-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Billing for early intervention services"
              disabled={isSaving}
            />
            <Label>Records covered</Label>
            <div className="space-y-1.5">
              {(Object.keys(RECORD_TYPE_LABELS) as RecordType[]).map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(t)}
                    onChange={() => toggleType(t)}
                    disabled={isSaving}
                  />
                  {RECORD_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
            <Label htmlFor="consent-proof">Proof note (optional)</Label>
            <Input
              id="consent-proof"
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder="e.g. Signed paper form on file"
              disabled={isSaving}
            />
            <p className="text-xs text-ink-muted">Expires one year from today unless revoked sooner.</p>
            <Button
              className="w-full"
              onClick={commitNew}
              disabled={!recipientName.trim() || !purpose.trim() || selectedTypes.length === 0}
              loading={isSaving}
            >
              Save consent
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this consent?"
        description={revokeTarget ? `Future disclosures to "${revokeTarget.recipient_name}" will be blocked immediately.` : ""}
        confirmLabel="Revoke"
        destructive
        onConfirm={commitRevoke}
        loading={isRevoking}
      />
    </div>
  );
}
```

- [ ] **Step 3: Render `PatientConsents` in `PatientDetail.tsx`**

Add the import alongside the other component imports:

```typescript
import { PatientConsents } from "@/components/PatientConsents";
```

Insert the component immediately after the patient info card's closing `</div>` (the `{patient && (...)}` block showing Child ID/Date of birth/County/Status, which ends at line 393 — confirm with `grep -n "Status" mobile/src/pages/PatientDetail.tsx` since line numbers may have shifted), inside the same `px-4 py-4` wrapper:

```tsx
        )}

        {patient && (
          <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
            <PatientConsents patientId={patient.id} />
          </div>
        )}
```

(Wrapped in the same card styling as the info block above it, consistent with how this page's other sections are presented — gated on `patient` existing, same as the info card, so it never renders with an undefined `patientId`.)

- [ ] **Step 4: Typecheck and build**

Run: `cd mobile && npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 5: Manual verification (no automated mobile tests in this repo)**

Describe exactly what to check by hand:
1. Open a patient's detail screen as an independent practitioner. Confirm a "Consents" section appears with "No consents on file for this child yet."
2. Tap "Log consent," fill in a recipient, purpose, check "SEVF forms," save. Confirm it appears in the list with an "Active" badge, the correct expiration date (one year out), and the right record type chip text.
3. Tap "Revoke" on that consent, confirm in the dialog. Confirm the badge changes to "Revoked" and the Revoke button disappears from that row.
4. Log a second consent, this time leaving every checkbox unchecked, and confirm "Save consent" stays disabled.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/PatientConsents.tsx mobile/src/pages/PatientDetail.tsx mobile/src/types/index.ts
git commit -m "Add Consents section to patient detail screen"
```

---

### Task 6: Mobile — surface the consent-required error in the agency-email dialog

**Files:**
- Modify: `mobile/src/pages/SevfHistory.tsx`

**Interfaces:**
- Consumes: the `code: 'CONSENT_REQUIRED'` field on a `400` response from `POST /api/billing/independent/email-sevf`, added in Task 4. `GeneratedSevfResult.patientId` (already present on the type — see `mobile/src/types/index.ts:156`).

- [ ] **Step 1: Read the current `handleSendEmail` catch block**

Re-read `mobile/src/pages/SevfHistory.tsx`'s `handleSendEmail` function to confirm the current catch block still matches what this plan expects (it currently calls `showToast(body?.error || "Couldn't send the email. Please try again.", "error")` on any failure) before editing.

- [ ] **Step 2: Add navigation and a distinct message for the consent-required case**

Add `useNavigate` to the existing `react-router-dom` import at the top of the file:

```typescript
import { useNavigate } from "react-router-dom";
```

Add the hook near the top of the component body, alongside the existing `useToast`/`useAppData` hook calls:

```typescript
const navigate = useNavigate();
```

Replace the `handleSendEmail` catch block:

```typescript
} catch (err) {
  const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
  if (body?.code === "CONSENT_REQUIRED" && emailTarget) {
    showToast(body.error || "Consent is required before this can be sent.", "error");
    setEmailTarget(null);
    navigate(`/patients/${emailTarget.patientId}`, { state: { scrollToConsents: true } });
    return;
  }
  showToast(body?.error || "Couldn't send the email. Please try again.", "error");
} finally {
  setIsSendingEmail(false);
}
```

(The `{ state: { scrollToConsents: true } }` is passed for future use — this task does not implement the scroll-to behavior on `PatientDetail.tsx`'s receiving end, since that's a small UX nicety, not required for the consent gate itself to be visible and actionable: the toast already names what's missing, and the practitioner lands on the right patient's screen where the Consents section is visible without scrolling on most devices.)

- [ ] **Step 3: Confirm `ApiErrorBody`'s `code` field already exists**

Run: `grep -n "code" mobile/src/types/index.ts | grep -A2 -B2 ApiErrorBody`
Expected: confirms `code?: string;` is already present on `ApiErrorBody` (added before this plan was written — no type change needed here).

- [ ] **Step 4: Typecheck and build**

Run: `cd mobile && npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 5: Manual verification**

1. As an independent practitioner, generate a SEVF for a child with no consent on file for the target agency.
2. From SEVF History, tap "Email to Agency," enter an email, send.
3. Confirm the toast shows the specific "No consent on file for..." message (not the generic failure message), and the app navigates to that child's detail screen.
4. Log a matching consent (recipient name exactly matching the agency, "SEVF forms" checked), retry the send, confirm it now succeeds.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/pages/SevfHistory.tsx
git commit -m "Surface consent-required errors in the agency-email dialog"
```

---

## Completion

After Task 6, the gap is fully closed end-to-end: a consent record can be created, viewed, and revoked from the mobile patient screen; `emailSevfToAgency` refuses to send without one covering the right recipient and record types; and the practitioner gets a clear, actionable error (not a generic failure) when blocked. Deploy backend (Cloud Run) and mobile (per this project's existing mobile release process) once the final whole-branch review (see the chosen execution skill's own process) is clean.
