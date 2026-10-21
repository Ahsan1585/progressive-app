# Overview Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the office-staff-only "Overview" dashboard (`CompanyDashboard.jsx`) to match a reference visual style, add a "Services provided" breakdown section and an "Invoices & SEVF forms" document feed, and add a per-viewer drag-to-reorder "Customize" capability.

**Architecture:** Four new backend endpoints under `/api/dashboard/*` (reusing the existing `dashboardGuard` permission gate and `AsyncLocalStorage` tenant scoping), one new migration for a `dashboard_layouts` table, and frontend changes confined to `CompanyDashboard.jsx` — restyled existing sub-components plus two new ones (`ServicesBreakdown`, `DocumentsFeed`) and a drag-to-reorder wrapper around the section cards.

**Tech Stack:** Node/Express + `pg` (backend), React + Tailwind + `recharts` + `lucide-react` icons (frontend, all already dependencies — no new packages).

**Spec:** `docs/superpowers/specs/2026-10-20-overview-dashboard-redesign-design.md`

## Global Constraints

- This page is reachable only by logins with the `master_reports` permission (office staff: CEO, billing, back-office) — never a clinical practitioner's own view. Every new route uses the existing `dashboardGuard = [protect, loadPermissions, requirePermission('master_reports')]` from `backend/src/routes/dashboardRoutes.js`.
- `practitioners` is this app's single logins table for every role; `dashboard_layouts.practitioner_id` stores an office-staff viewer's id, never a clinical practitioner's, because only office-staff logins ever reach these endpoints.
- No new npm dependencies — reuse `recharts`, `lucide-react`, Tailwind utility classes already in `frontend/package.json`.
- No change to existing Day/Month/Year/AP computation logic in `dashboardController.js` — only additive new functions.
- Discipline means `practitioners.position_title`, never `practitioners.service_types` — this exact mixup was a real, twice-corrected bug elsewhere in this app (Staff Directory care-team chips); do not repeat it.
- `formatInvoiceNumber`, `deriveEimsStatus`, and `loadComplianceForLines` must be reused from `backend/src/utils/invoiceData.js`, not reimplemented.

## Review Focus

- A tenant with null `assessments.type`/`.location` for some sessions in the selected month — `getServicesBreakdown` must bucket those into an explicit "Not specified" category so the stacked bar's total still equals the month's real session count, not silently drop them.
- A `billing_batches` row with zero assessment lines attached — `getDocumentsFeed` must render `0 sessions` / `$0.00` / `pending`, not divide-by-zero or `NaN`.
- `PUT /api/dashboard/layout` with a payload that is not an exact permutation of `DASHBOARD_SECTION_KEYS` (missing key, duplicate key, unknown key, wrong length) — must 400, not silently accept and corrupt the saved layout.
- `PUT /api/dashboard/layout` called by a login without `master_reports` — must 403 via the existing `dashboardGuard`, not a bespoke check that could be missed.
- A batch whose lines are a mix of `cleared` and one `exception` tier — `getDocumentsFeed`'s roll-up must report the whole batch as `mismatch` ("worst wins"), not average/majority-vote toward `matched`.

---

## Task 1: `dashboard_layouts` migration + layout read/write endpoints

**Files:**
- Create: `backend/db/migrations/add_dashboard_layouts.sql`
- Create: `backend/src/controllers/__tests__/dashboardLayout.test.js`
- Modify: `backend/src/controllers/dashboardController.js` (add `getDashboardLayout`, `saveDashboardLayout`, `DASHBOARD_SECTION_KEYS`)
- Modify: `backend/src/routes/dashboardRoutes.js` (add `GET`/`PUT /layout`)

**Interfaces:**
- Produces: `DASHBOARD_SECTION_KEYS` (exported array of 5 strings: `['pipeline_and_queue', 'services', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory']`), `getDashboardLayout(req, res)`, `saveDashboardLayout(req, res)`.

- [ ] **Step 1: Write the migration**

```sql
-- backend/db/migrations/add_dashboard_layouts.sql
-- One row per office-staff viewer's saved Overview-dashboard section
-- order. FK is to practitioners(id) because that's this app's single
-- logins table for every role, but only office-staff logins (gated by
-- dashboardGuard's master_reports permission check) ever read/write this
-- table — never a clinical practitioner's own login.
CREATE TABLE dashboard_layouts (
  practitioner_id integer PRIMARY KEY REFERENCES practitioners(id),
  section_order jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Apply it to the local/dev database the same way other migrations in `backend/db/migrations/` are applied in this project (run the SQL file directly against the tenant DB via `psql` or the project's existing migration-runner, matching how `add_patient_practitioner_deactivation_reason.sql` was applied earlier in this project's history).

- [ ] **Step 2: Write the failing tests**

```javascript
// backend/src/controllers/__tests__/dashboardLayout.test.js
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../../config/db');
const { getDashboardLayout, saveDashboardLayout, DASHBOARD_SECTION_KEYS } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('DASHBOARD_SECTION_KEYS', () => {
  test('is the fixed 5-key set the frontend and validation both rely on', () => {
    expect(DASHBOARD_SECTION_KEYS).toEqual([
      'pipeline_and_queue', 'services', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory',
    ]);
  });
});

describe('getDashboardLayout', () => {
  test('returns the saved order when one exists', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [{ section_order: ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'] }] });

    await getDashboardLayout(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      sectionOrder: ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'],
    });
  });

  test('returns null sectionOrder when the viewer has never customized', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getDashboardLayout(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, sectionOrder: null });
  });
});

describe('saveDashboardLayout', () => {
  test('upserts a valid permutation of DASHBOARD_SECTION_KEYS', async () => {
    const order = ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'];
    const req = { practitioner: { practitionerId: 7 }, body: { sectionOrder: order } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await saveDashboardLayout(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (practitioner_id)'),
      [7, JSON.stringify(order)]
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('400s on a payload missing a required key', async () => {
    const req = { practitioner: { practitionerId: 7 }, body: { sectionOrder: ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status'] } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s on a payload with a duplicate key', async () => {
    const req = { practitioner: { practitionerId: 7 }, body: { sectionOrder: ['services', 'services', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'] } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s on a payload with an unknown key', async () => {
    const req = { practitioner: { practitionerId: 7 }, body: { sectionOrder: ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status', 'not_a_real_section'] } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2b: Run tests to verify they fail**

Run: `cd backend && npx jest dashboardLayout.test.js`
Expected: FAIL — `getDashboardLayout`/`saveDashboardLayout`/`DASHBOARD_SECTION_KEYS` not exported from `dashboardController.js`.

- [ ] **Step 3: Implement**

Add to `backend/src/controllers/dashboardController.js` (near the top, after the existing `OPEN_EXCEPTION_STATUSES` constant):

```javascript
// The fixed, ordered set of reorderable Overview-dashboard section groups.
// Grouped at two-column-row granularity (matching the existing grid pairs
// in CompanyDashboard.jsx), not per individual card — splitting pairs like
// BillingFunnel+ActionQueue apart would require redesigning the responsive
// grid itself, out of scope for this pass.
const DASHBOARD_SECTION_KEYS = [
  'pipeline_and_queue',
  'services',
  'accuracy_table',
  'eims_status',
  'returned_logs_and_trajectory',
];

// GET /api/dashboard/layout — the calling office-staff viewer's saved
// Overview section order, or null if they've never customized (frontend
// falls back to DASHBOARD_SECTION_KEYS's default order).
const getDashboardLayout = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT section_order FROM dashboard_layouts WHERE practitioner_id = $1',
      [req.practitioner.practitionerId]
    );
    res.json({ success: true, sectionOrder: rows[0]?.section_order || null });
  } catch (error) {
    console.error('getDashboardLayout error:', error);
    res.status(500).json({ success: false, error: 'Failed to load dashboard layout' });
  }
};

// PUT /api/dashboard/layout — upserts the calling viewer's section order.
// Validated server-side as an exact permutation of DASHBOARD_SECTION_KEYS
// (no unknown/missing/duplicate keys) rather than trusting the client's
// array blindly.
const saveDashboardLayout = async (req, res) => {
  const { sectionOrder } = req.body;
  const isValidPermutation = Array.isArray(sectionOrder)
    && sectionOrder.length === DASHBOARD_SECTION_KEYS.length
    && new Set(sectionOrder).size === DASHBOARD_SECTION_KEYS.length
    && sectionOrder.every((k) => DASHBOARD_SECTION_KEYS.includes(k));
  if (!isValidPermutation) {
    return res.status(400).json({ success: false, error: 'sectionOrder must be a permutation of the known dashboard sections' });
  }

  try {
    await pool.query(
      `INSERT INTO dashboard_layouts (practitioner_id, section_order, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (practitioner_id) DO UPDATE SET section_order = $2, updated_at = now()`,
      [req.practitioner.practitionerId, JSON.stringify(sectionOrder)]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('saveDashboardLayout error:', error);
    res.status(500).json({ success: false, error: 'Failed to save dashboard layout' });
  }
};
```

Add `getDashboardLayout, saveDashboardLayout, DASHBOARD_SECTION_KEYS` to the `module.exports` object at the bottom of the file.

In `backend/src/routes/dashboardRoutes.js`, add to the imports and routes:

```javascript
const { getDayOverview, getPipelineOverview, getReturnedLogs, getSessionDetail, getMonthOverview, getYearOverview, getAccountsPayable, getDashboardLayout, saveDashboardLayout } = require('../controllers/dashboardController');
```
```javascript
router.get('/layout', ...dashboardGuard, getDashboardLayout);
router.put('/layout', ...dashboardGuard, saveDashboardLayout);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest dashboardLayout.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/add_dashboard_layouts.sql backend/src/controllers/dashboardController.js backend/src/controllers/__tests__/dashboardLayout.test.js backend/src/routes/dashboardRoutes.js
git commit -m "Add per-viewer dashboard layout read/write endpoints"
```

---

## Task 2: `getServicesBreakdown` endpoint

**Files:**
- Modify: `backend/src/controllers/dashboardController.js` (add `getServicesBreakdown`)
- Modify: `backend/src/controllers/__tests__/` — create `dashboardServices.test.js`
- Modify: `backend/src/routes/dashboardRoutes.js`

**Interfaces:**
- Consumes: `parseMonthParam` (already defined in `dashboardController.js`), `serviceCodeLabel`/`locationCodeLabel` from `backend/src/constants/njeis.js`.
- Produces: `getServicesBreakdown(req, res)` returning `{ success, month, byServiceType, byStatus, byLocation, byDiscipline }`, each a `[{ key, label, count }]` array, top-6-plus-"Other", nulls bucketed as `"Not specified"`.

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/controllers/__tests__/dashboardServices.test.js
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../constants/njeis', () => ({
  serviceCodeLabel: (code) => (code === 'DI' ? 'Developmental Intervention' : code === 'OT' ? 'Occupational Therapy' : code),
  locationCodeLabel: (code) => (code === 'HOME' ? 'Home' : code),
}));

const { pool } = require('../../config/db');
const { getServicesBreakdown } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('getServicesBreakdown', () => {
  test('returns all four dimensions with resolved labels, sorted by count desc', async () => {
    const req = { query: { month: '2026-10' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'OT', count: '5' }, { type: 'DI', count: '12' }] }) // service type
      .mockResolvedValueOnce({ rows: [{ billing_status: 'invoiced', count: '10' }] }) // status
      .mockResolvedValueOnce({ rows: [{ location: 'HOME', count: '17' }] }) // location
      .mockResolvedValueOnce({ rows: [{ position_title: 'OT', count: '17' }] }); // discipline

    await getServicesBreakdown(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.byServiceType).toEqual([
      { key: 'DI', label: 'Developmental Intervention', count: 12 },
      { key: 'OT', label: 'Occupational Therapy', count: 5 },
    ]);
    expect(payload.byLocation).toEqual([{ key: 'HOME', label: 'Home', count: 17 }]);
    expect(payload.byDiscipline).toEqual([{ key: 'OT', label: 'OT', count: 17 }]);
  });

  test('buckets a null dimension value as "Not specified" rather than dropping it', async () => {
    const req = { query: { month: '2026-10' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: null, count: '3' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await getServicesBreakdown(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.byServiceType).toEqual([{ key: null, label: 'Not specified', count: 3 }]);
  });

  test('collapses beyond the top 6 into an "Other" bucket', async () => {
    const req = { query: { month: '2026-10' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const rows = Array.from({ length: 8 }, (_, i) => ({ type: `T${i}`, count: String(10 - i) }));
    pool.query
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await getServicesBreakdown(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.byServiceType).toHaveLength(7); // top 6 + Other
    expect(payload.byServiceType[6]).toEqual({ key: 'other', label: 'Other', count: 3 + 2 }); // T6(4)+T7(3) = but counts are 10,9,8,7,6,5,4,3 -> top6 sum=10+9+8+7+6+5=45, remainder T6(4)+T7(3)=7
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest dashboardServices.test.js`
Expected: FAIL — `getServicesBreakdown` is not a function (undefined import).

- [ ] **Step 3: Implement**

Add to `backend/src/controllers/dashboardController.js`:

```javascript
const { serviceCodeLabel, locationCodeLabel } = require('../constants/njeis');

const STATUS_BREAKDOWN_LABELS = {
  pending: 'Pending review',
  njeis_review: 'In EIMS review',
  invoiced: 'Invoiced',
  completed: 'Invoiced',
  self_certified: 'Self-certified',
  on_hold: 'On hold',
  rejected: 'Returned',
  declined: 'Returned',
  voided: 'Voided',
};

// Resolves raw {key, count} rows into labeled, sorted, top-6-plus-Other
// buckets — shared shape for all four Services-provided dimensions. A null
// key becomes an explicit "Not specified" bucket rather than being
// dropped, so the stacked bar's total always matches the month's real
// session count.
function bucketBreakdown(rows, keyField, labelFn) {
  const resolved = rows.map((r) => {
    const key = r[keyField];
    return {
      key,
      label: key == null ? 'Not specified' : labelFn(key),
      count: parseInt(r.count, 10),
    };
  });
  resolved.sort((a, b) => b.count - a.count);
  if (resolved.length <= 6) return resolved;
  const top6 = resolved.slice(0, 6);
  const otherCount = resolved.slice(6).reduce((sum, r) => sum + r.count, 0);
  return [...top6, { key: 'other', label: 'Other', count: otherCount }];
}

// GET /api/dashboard/services?month=YYYY-MM — this month's session counts
// broken down by service type / status / location / discipline, all four
// dimensions in one response so the frontend's tab switch is instant with
// no refetch. Discipline comes from practitioners.position_title (the
// actual discipline/title field), never service_types (billable service
// categories) — see Global Constraints.
const getServicesBreakdown = async (req, res) => {
  try {
    const { start, end } = parseMonthParam(req.query.month);

    const { rows: typeRows } = await pool.query(
      `SELECT type, COUNT(*)::int AS count FROM assessments
       WHERE service_date >= $1 AND service_date <= $2 GROUP BY type`,
      [start, end]
    );
    const { rows: statusRows } = await pool.query(
      `SELECT billing_status, COUNT(*)::int AS count FROM assessments
       WHERE service_date >= $1 AND service_date <= $2 GROUP BY billing_status`,
      [start, end]
    );
    const { rows: locationRows } = await pool.query(
      `SELECT location, COUNT(*)::int AS count FROM assessments
       WHERE service_date >= $1 AND service_date <= $2 GROUP BY location`,
      [start, end]
    );
    const { rows: disciplineRows } = await pool.query(
      `SELECT p.position_title, COUNT(*)::int AS count
       FROM assessments a JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.service_date >= $1 AND a.service_date <= $2 GROUP BY p.position_title`,
      [start, end]
    );

    res.json({
      success: true,
      month: req.query.month || null,
      byServiceType: bucketBreakdown(typeRows, 'type', serviceCodeLabel),
      byStatus: bucketBreakdown(statusRows, 'billing_status', (k) => STATUS_BREAKDOWN_LABELS[k] || k),
      byLocation: bucketBreakdown(locationRows, 'location', locationCodeLabel),
      byDiscipline: bucketBreakdown(disciplineRows, 'position_title', (k) => k),
    });
  } catch (error) {
    console.error('getServicesBreakdown error:', error);
    res.status(500).json({ success: false, error: 'Failed to load services breakdown' });
  }
};
```

Add `getServicesBreakdown` to `module.exports`. In `dashboardRoutes.js`, add to imports and:

```javascript
router.get('/services', ...dashboardGuard, getServicesBreakdown);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest dashboardServices.test.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/dashboardController.js backend/src/controllers/__tests__/dashboardServices.test.js backend/src/routes/dashboardRoutes.js
git commit -m "Add Services-provided breakdown endpoint to Overview dashboard"
```

---

## Task 3: `getDocumentsFeed` endpoint

**Files:**
- Modify: `backend/src/controllers/dashboardController.js` (add `getDocumentsFeed`)
- Create: `backend/src/controllers/__tests__/dashboardDocuments.test.js`
- Modify: `backend/src/routes/dashboardRoutes.js`

**Interfaces:**
- Consumes: `loadComplianceForLines`, `deriveEimsStatus` from `backend/src/utils/invoiceData.js`; `computeSessionCompliance` from `billingController.js` (already imported at the top of `dashboardController.js`); `formatInvoiceNumber` from `invoiceData.js` (new import).
- Produces: `getDocumentsFeed(req, res)` returning `{ success, documents: [{ batchId, documentNumber, documentType, practitionerName, sessionCount, amount, status, createdAt }] }`.

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/controllers/__tests__/dashboardDocuments.test.js
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceForLines: jest.fn(),
  deriveEimsStatus: jest.fn(),
  formatInvoiceNumber: (id) => `INV-${String(id).slice(0, 8).toUpperCase()}`,
}));

const { pool } = require('../../config/db');
const { loadComplianceForLines, deriveEimsStatus } = require('../../utils/invoiceData');
const { getDocumentsFeed } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('getDocumentsFeed', () => {
  test('labels an independent-practitioner batch as SEVF and an agency batch as invoice', async () => {
    const req = {};
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ // batches
        rows: [
          { id: 'batch-agency-01', practitioner_id: 1, first_name: 'Aiden', last_name: 'Holt', role: 'practitioner', created_at: '2026-10-14T10:00:00Z' },
          { id: 'batch-indep-02', practitioner_id: 2, first_name: 'Nora', last_name: 'Diaz', role: 'independent_practitioner', created_at: '2026-10-13T10:00:00Z' },
        ],
      })
      .mockResolvedValueOnce({ // lines for batch-agency-01
        rows: [{ id: 10, billing_batch_id: 'batch-agency-01', total_time: 60, pay_rate: '50.00', practitioner_id: 1, role: 'practitioner' }],
      })
      .mockResolvedValueOnce({ // lines for batch-indep-02
        rows: [{ id: 20, billing_batch_id: 'batch-indep-02', total_time: 60, pay_rate: '60.00', practitioner_id: 2, role: 'independent_practitioner' }],
      });
    loadComplianceForLines.mockResolvedValue(new Map());
    deriveEimsStatus.mockReturnValue({ tier: 'cleared' });

    await getDocumentsFeed(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.documents[0]).toMatchObject({ documentType: 'invoice', practitionerName: 'Aiden Holt', sessionCount: 1, amount: 50 });
    expect(payload.documents[1]).toMatchObject({ documentType: 'sevf', practitionerName: 'Nora Diaz', sessionCount: 1, amount: 60 });
  });

  test('"worst wins": one exception line among cleared lines makes the whole batch mismatch', async () => {
    const req = {};
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'batch-1', practitioner_id: 1, first_name: 'A', last_name: 'B', role: 'practitioner', created_at: '2026-10-14T10:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 10, billing_batch_id: 'batch-1', total_time: 60, pay_rate: '50.00', practitioner_id: 1, role: 'practitioner' },
        { id: 11, billing_batch_id: 'batch-1', total_time: 60, pay_rate: '50.00', practitioner_id: 1, role: 'practitioner' },
      ] });
    loadComplianceForLines.mockResolvedValue(new Map());
    deriveEimsStatus
      .mockReturnValueOnce({ tier: 'cleared' })
      .mockReturnValueOnce({ tier: 'exception' });

    await getDocumentsFeed(req, res);

    expect(res.json.mock.calls[0][0].documents[0].status).toBe('mismatch');
  });

  test('a batch with zero assessment lines returns 0 sessions / $0.00 / pending, no crash', async () => {
    const req = {};
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'batch-empty', practitioner_id: 1, first_name: 'A', last_name: 'B', role: 'practitioner', created_at: '2026-10-14T10:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] });
    loadComplianceForLines.mockResolvedValue(new Map());

    await getDocumentsFeed(req, res);

    expect(res.json.mock.calls[0][0].documents[0]).toMatchObject({ sessionCount: 0, amount: 0, status: 'pending' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest dashboardDocuments.test.js`
Expected: FAIL — `getDocumentsFeed` is not a function.

- [ ] **Step 3: Implement**

Add import at top of `dashboardController.js`:

```javascript
const { buildInvoiceLines, deriveEimsStatus, loadComplianceForLines, formatInvoiceNumber } = require('../utils/invoiceData');
```

(This replaces the existing `const { buildInvoiceLines, deriveEimsStatus, loadComplianceForLines } = require('../utils/invoiceData');` line near the top of the file — add `formatInvoiceNumber` to that same destructure rather than a second require.)

```javascript
// GET /api/dashboard/documents — most recent 20 billing_batches, each
// rolled up to one status: "worst wins" across its assessment lines (any
// exception -> mismatch; else any pending/unverified -> pending; else
// matched), mirroring the human-hold-overrides-EIMS-tier rule used
// elsewhere on this dashboard. No separate SEVF table exists in this
// schema — a batch for an independent_practitioner is simply labeled
// "sevf" instead of "invoice"; the document number format is identical
// either way (formatInvoiceNumber ties back to the same billing_batches row).
const getDocumentsFeed = async (req, res) => {
  try {
    const { rows: batches } = await pool.query(
      `SELECT bb.id, bb.created_at, bb.practitioner_id, p.first_name, p.last_name, p.role
       FROM billing_batches bb
       JOIN practitioners p ON p.id = bb.practitioner_id
       ORDER BY bb.created_at DESC
       LIMIT 20`
    );

    const documents = [];
    for (const batch of batches) {
      const { rows: lines } = await pool.query(
        `SELECT a.id, a.total_time, p.pay_rate, a.practitioner_id, p.role,
                a.eims_missing_status, a.eims_entered_at, a.is_override
         FROM assessments a JOIN practitioners p ON p.id = a.practitioner_id
         WHERE a.billing_batch_id = $1`,
        [batch.id]
      );

      const sessionCount = lines.length;
      const amount = Math.round(
        lines.reduce((sum, l) => sum + (l.total_time ? l.total_time / 60 : 0) * parseFloat(l.pay_rate || 0), 0) * 100
      ) / 100;

      let status = 'pending';
      if (sessionCount > 0) {
        const complianceById = await loadComplianceForLines(
          lines.filter((l) => l.role !== 'independent_practitioner').map((l) => l.id),
          computeSessionCompliance
        );
        const tiers = lines.map((l) => {
          const mode = l.role === 'independent_practitioner' ? 'independent' : 'agency';
          const compliance = complianceById.get(l.id) || null;
          return deriveEimsStatus(l, { mode, compliance }).tier;
        });
        if (tiers.some((t) => t === 'exception')) status = 'mismatch';
        else if (tiers.every((t) => t === 'cleared')) status = 'matched';
        else status = 'pending';
      }

      documents.push({
        batchId: batch.id,
        documentNumber: formatInvoiceNumber(batch.id),
        documentType: batch.role === 'independent_practitioner' ? 'sevf' : 'invoice',
        practitionerName: `${batch.first_name} ${batch.last_name}`,
        sessionCount,
        amount,
        status,
        createdAt: batch.created_at,
      });
    }

    res.json({ success: true, documents });
  } catch (error) {
    console.error('getDocumentsFeed error:', error);
    res.status(500).json({ success: false, error: 'Failed to load documents feed' });
  }
};
```

Add `getDocumentsFeed` to `module.exports`. In `dashboardRoutes.js`:

```javascript
router.get('/documents', ...dashboardGuard, getDocumentsFeed);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest dashboardDocuments.test.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/dashboardController.js backend/src/controllers/__tests__/dashboardDocuments.test.js backend/src/routes/dashboardRoutes.js
git commit -m "Add Invoices & SEVF forms document feed endpoint to Overview dashboard"
```

---

## Task 4: Frontend restyle — hero banner, stat cards, pipeline, action queue

**Files:**
- Modify: `frontend/src/components/CompanyDashboard.jsx:269-376` (`VerdictBanner`, `StatCard`, `ActionQueue`, `BillingFunnel`)

**Interfaces:**
- Consumes: existing `day`, `ap`, `month`, `pipeline` props — unchanged shapes except `ActionQueue`'s `day.flaggedSessions[]` rows gain an `amount` number field (added in this task's backend-adjacent step below).

No backend tests apply to this task (pure frontend restyle); verification is the dev server visual check in Task 8.

- [ ] **Step 1: Add `amount` to `getDayOverview`'s flagged sessions**

In `backend/src/controllers/dashboardController.js`, modify the `exceptionRows` query in `getDayOverview` (around line 28) to also select pay-rate/time so each flagged row can show a dollar amount, matching the reference screenshot's right-aligned `$185`/`$140`/`$290`:

```javascript
    const { rows: exceptionRows } = await pool.query(
      `SELECT a.id, a.billing_status, a.service_date, a.hold_note, a.rejection_note,
              COALESCE(a.held_at, a.rejected_at) AS flagged_at,
              a.patient_first_name, a.patient_last_name,
              a.practitioner_first_name, a.practitioner_last_name,
              a.total_time, p.pay_rate
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.billing_status = ANY($1::text[])
       ORDER BY COALESCE(a.held_at, a.rejected_at) ASC NULLS LAST
       LIMIT 200`,
      [OPEN_EXCEPTION_STATUSES]
    );
```

And in the response mapping, add `amount`:

```javascript
      flaggedSessions: exceptionRows.map((r) => ({
        id: r.id,
        status: r.billing_status,
        serviceDate: r.service_date,
        flaggedAt: r.flagged_at,
        note: r.hold_note || r.rejection_note || null,
        patientName: `${r.patient_first_name || ''} ${r.patient_last_name || ''}`.trim(),
        practitionerName: `${r.practitioner_first_name || ''} ${r.practitioner_last_name || ''}`.trim(),
        amount: Math.round((r.total_time ? r.total_time / 60 : 0) * parseFloat(r.pay_rate || 0) * 100) / 100,
      })),
```

- [ ] **Step 2: Restyle `VerdictBanner`**

Replace the `VerdictBanner` function in `CompanyDashboard.jsx` (lines 269-305):

```javascript
function VerdictBanner({ day, ap }) {
  if (!day || !ap) {
    return (
      <section className="rounded-[20px] p-7 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #1a2744 0%, #0f1829 100%)' }}>
        <div className="text-sm text-white/80">Loading today's picture...</div>
      </section>
    );
  }

  const flaggedCount = day.flaggedCount || 0;
  const totalOwed = ap.totalOwed || 0;
  const totalHeld = ap.totalHeld || 0;
  const heldPct = totalOwed > 0 ? Math.round((totalHeld / totalOwed) * 100) : 0;
  const clearPct = 100 - heldPct;

  const isHealthy = flaggedCount === 0 && totalHeld === 0;
  const headline = isHealthy
    ? 'Billing is healthy. Nothing is waiting on you today.'
    : flaggedCount > 0 && totalHeld === 0
      ? `Billing is healthy. ${flaggedCount} session${flaggedCount === 1 ? ' is' : 's are'} stuck and need${flaggedCount === 1 ? 's' : ''} a decision.`
      : `${flaggedCount > 0 ? `${flaggedCount} sessions need a decision and ` : ''}${compactMoney(totalHeld)} is being held pending verification.`;

  return (
    <section className="rounded-[20px] p-7 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #1a2744 0%, #0f1829 100%)' }}>
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: '#fcd34d' }}>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#fcd34d' }} />
            {isHealthy ? 'All clear' : 'Needs a look today'}
          </div>
          <h1 className="text-2xl sm:text-[26px] font-bold leading-snug mb-2.5" style={{ textWrap: 'balance' }}>{headline}</h1>
          <p className="text-sm leading-relaxed max-w-2xl" style={{ color: 'rgba(253,253,255,0.86)' }}>
            <b className="text-white font-bold">{money(totalOwed)}</b> is owed to practitioners.
            {flaggedCount > 0 && <> The open item is <b className="text-white font-bold">{flaggedCount} flagged session{flaggedCount === 1 ? '' : 's'}</b>.</>}
          </p>
        </div>
        {totalOwed > 0 && (
          <div className="min-w-[180px]">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-white/70">Cleared</span>
              <span className="font-bold font-mono tabular-nums">{clearPct}%</span>
            </div>
            <div className="w-[180px] h-2 rounded-full bg-white/15 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${clearPct}%` }} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Restyle `StatCard`**

Replace the `StatCard` function (lines 307-329):

```javascript
function StatCard({ icon: Icon, tone, label, value, deltaText, deltaTone }) {
  const toneBg = {
    teal: 'bg-teal-50 text-teal-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  const deltaClasses = {
    up: 'text-teal-700',
    down: 'text-rose-700',
    flat: 'text-slate-400',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-[18px] pb-4 min-w-0 relative">
      <div className={`absolute top-3.5 right-3.5 w-9 h-9 rounded-full flex items-center justify-center ${toneBg[tone]}`}>
        <Icon className="size-4" />
      </div>
      <div className="text-sm text-slate-500 mb-1.5 pr-9">{label}</div>
      <div className="text-[25px] font-bold tracking-tight mb-2 font-mono tabular-nums">{value}</div>
      <div className={`inline-flex items-center gap-1 text-xs font-semibold ${deltaClasses[deltaTone || 'flat']}`}>{deltaText}</div>
    </div>
  );
}
```

- [ ] **Step 4: Restyle `ActionQueue` with right-aligned amount**

Replace the `sessions.map` block inside `ActionQueue` (lines 345-371), adding the `amount` display:

```javascript
          {sessions.map((s) => {
            const age = daysAgo(s.flaggedAt || s.serviceDate);
            const isCritical = age !== null && age > 30;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSession(s.id)}
                className="w-full flex items-center gap-3 bg-slate-50 hover:bg-slate-100 transition-colors rounded-xl px-3.5 py-2.5 min-w-0 text-left cursor-pointer"
              >
                <div className={`w-[3px] self-stretch rounded-sm flex-shrink-0 ${isCritical ? 'bg-rose-600' : 'bg-amber-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-slate-900 truncate">
                    {s.patientName} &middot; {s.practitionerName}
                  </div>
                  <div className="text-[11.5px] text-slate-500 truncate">
                    {s.note || 'On hold, no note on file'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[13.5px] font-bold text-slate-900 font-mono tabular-nums">{money(s.amount)}</span>
                  {age !== null && (
                    <span className={`text-[10.5px] font-bold px-2 py-1 rounded-full ${isCritical ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                      {age}d
                    </span>
                  )}
                </div>
              </button>
            );
          })}
```

- [ ] **Step 5: Restyle `BillingFunnel`**

Replace the `stages.map` render block inside `BillingFunnel` (lines 397-412):

```javascript
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-3 mb-3 last:mb-0">
          <div className="w-[88px] flex-shrink-0">
            <div className="text-xs font-semibold text-slate-500">{s.label}</div>
            {s.sub && <div className="text-[10px] font-semibold text-rose-600 mt-0.5">{s.sub}</div>}
          </div>
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 2 : 0)}%` }}
            />
          </div>
          <div className="w-14 flex-shrink-0 text-right text-xs font-bold text-slate-900 font-mono tabular-nums">{s.value.toLocaleString()}</div>
        </div>
      ))}
```

(The `gradient` field on each stage in the `stages` array above this block is no longer read by this render — leave the `stages` array's `gradient` properties in place since Task 7's self-review will confirm they're dead but harmless, not worth a separate cleanup step here.)

- [ ] **Step 6: Visual check**

Run: `cd frontend && npm run dev` (or confirm the existing dev server is running), open the Overview tab, confirm no console errors and the hero/stat cards/pipeline/action queue render with the new styling.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/dashboardController.js frontend/src/components/CompanyDashboard.jsx
git commit -m "Restyle Overview dashboard hero, stat cards, pipeline, and action queue"
```

---

## Task 5: Frontend restyle — EIMS donut, practitioner accuracy, returned logs

**Files:**
- Modify: `frontend/src/components/CompanyDashboard.jsx` (`EimsDonut`, `PractitionerAccuracyTable`)
- Modify: `backend/src/controllers/dashboardController.js` (`getMonthOverview`'s `practitionerAccuracy` row — add `discipline`)
- Modify: `backend/src/controllers/__tests__/` — find and update the existing month-overview test if one references `practitionerAccuracy`'s exact shape

**Interfaces:**
- Consumes: `month.practitionerAccuracy[]` — gains a new `discipline` string field.

- [ ] **Step 1: Check for an existing test asserting `practitionerAccuracy`'s exact row shape**

Run: `cd backend && grep -rl "practitionerAccuracy" src/controllers/__tests__/`

If a test asserts the row's exact keys with `toEqual` (not `toMatchObject`), it will need `discipline` added to its expected object in this task's implementation step — read that file before Step 2.

- [ ] **Step 2: Add `discipline` to the accuracy query**

In `backend/src/controllers/dashboardController.js`, `getMonthOverview`, the `practitionerRoleRows` query already selects `id, role, first_name, last_name` from `practitioners` — add `position_title`:

```javascript
    const { rows: practitionerRoleRows } = await pool.query(
      `SELECT id, role, first_name, last_name, position_title FROM practitioners WHERE id = ANY($1::int[])`,
      [[...new Set([...billedSessions.map((s) => s.practitioner_id), ...pendingCheckedSessions.map((s) => s.practitioner_id)])]]
    );
```

And in the `practitionerAccuracy` mapping (the `.map(([practitionerId, acc]) => {...})` block), add `discipline`:

```javascript
    const practitionerAccuracy = [...accuracyByPractitioner.entries()].map(([practitionerId, acc]) => {
      const p = practitionerRoleRows.find((r) => r.id === practitionerId);
      return {
        practitionerId,
        name: p ? `${p.first_name} ${p.last_name}` : 'Unknown',
        discipline: p?.position_title || '',
        sessionsChecked: acc.total,
        cleanMatches: acc.clean,
        heldOrReturned: acc.held,
        accuracyPct: acc.total > 0 ? Math.round((acc.clean / acc.total) * 1000) / 10 : null,
      };
    }).sort((a, b) => (a.accuracyPct ?? 101) - (b.accuracyPct ?? 101));
```

- [ ] **Step 3: Run existing dashboard tests to confirm nothing broke**

Run: `cd backend && npx jest dashboardController`
Expected: PASS — any pre-existing month-overview tests still pass (update per Step 1's finding if needed), confirming the additive field didn't break existing assertions.

- [ ] **Step 4: Restyle `PractitionerAccuracyTable`'s row to show discipline + thinner bar**

In `CompanyDashboard.jsx`, inside `PractitionerAccuracyTable`'s `tbody` row render (around lines 242-256), replace the practitioner-name cell and the accuracy-bar cell:

```javascript
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-800">{r.name}</div>
                      {r.discipline && <div className="text-[11px] text-slate-500">{r.discipline}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
                          <div className="h-full rounded-full" style={{ width: `${r.accuracyPct ?? 0}%`, background: tone.bar }} />
                        </div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tone.bg} ${tone.text}`}>
                          {r.accuracyPct != null ? `${r.accuracyPct}%` : '—'}
                        </span>
                      </div>
                    </td>
```

- [ ] **Step 5: Simplify `EimsDonut`'s center label**

In `EimsDonut`, the `<text>` elements at lines 453-454 already show `{matchedPct}%` / `matched` — confirm font sizing matches the reference (slightly larger percentage, matching the screenshot's prominent "98%"): change `fontSize="20"` to `fontSize="24"` on the percentage `<text>` element.

- [ ] **Step 6: Visual check**

Run: `cd frontend && npm run dev`, open Overview tab, confirm EIMS donut and practitioner accuracy table render correctly with discipline subtitles.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/dashboardController.js frontend/src/components/CompanyDashboard.jsx
git commit -m "Add discipline to practitioner accuracy table, restyle EIMS donut"
```

---

## Task 6: `ServicesBreakdown` and `DocumentsFeed` frontend components

**Files:**
- Modify: `frontend/src/components/CompanyDashboard.jsx` (add `ServicesBreakdown`, `DocumentsFeed` components; wire their fetches into the `CompanyDashboard` function)

**Interfaces:**
- Consumes: `GET /api/dashboard/services?month=YYYY-MM` (Task 2), `GET /api/dashboard/documents` (Task 3).
- Produces: `<ServicesBreakdown data={services} />`, `<DocumentsFeed documents={documents} />` — both pure presentational components taking already-fetched data, same pattern as every other section component in this file.

- [ ] **Step 1: Add `ServicesBreakdown` component**

Add after `EimsDonut` in `CompanyDashboard.jsx`:

```javascript
const SERVICES_DIMENSIONS = [
  { key: 'byServiceType', label: 'Service type' },
  { key: 'byStatus', label: 'Status' },
  { key: 'byLocation', label: 'Location' },
  { key: 'byDiscipline', label: 'Discipline' },
];
const SERVICES_COLORS = ['#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed', '#64748b', '#94a3b8'];

function ServicesBreakdown({ data }) {
  const [dimension, setDimension] = useState('byServiceType');
  if (!data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="text-[15.5px] font-bold text-slate-900 mb-4">Services provided</div>
        <div className="text-sm text-slate-400 text-center py-8">Loading…</div>
      </div>
    );
  }

  const rows = data[dimension] || [];
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="text-[15.5px] font-bold text-slate-900">Services provided</div>
      </div>
      <p className="text-xs text-slate-500 mb-4">This month, by category</p>

      <div className="inline-flex bg-slate-50 rounded-[10px] p-[3px] gap-0.5 mb-4 flex-wrap">
        {SERVICES_DIMENSIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDimension(d.key)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              dimension === d.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">No sessions logged this month yet.</div>
      ) : (
        <>
          <div className="w-full h-2.5 rounded-full overflow-hidden flex mb-4">
            {rows.map((r, i) => (
              <div
                key={r.key ?? 'null'}
                style={{ width: `${total > 0 ? (r.count / total) * 100 : 0}%`, background: SERVICES_COLORS[i % SERVICES_COLORS.length] }}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {rows.map((r, i) => (
              <div key={r.key ?? 'null'} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-600 min-w-0">
                  <span className="w-2 h-2 rounded-[3px] flex-shrink-0" style={{ background: SERVICES_COLORS[i % SERVICES_COLORS.length] }} />
                  <span className="truncate">{r.label}</span>
                </div>
                <span className="font-mono font-semibold text-slate-900 flex-shrink-0">{r.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `DocumentsFeed` component**

Add after `ServicesBreakdown`:

```javascript
const DOC_STATUS_TONE = {
  matched: { bg: 'bg-teal-50', text: 'text-teal-700', label: 'Matched' },
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending' },
  mismatch: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Mismatch' },
};

function DocumentsFeed({ documents }) {
  if (!documents) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="text-[15.5px] font-bold text-slate-900 mb-4">Invoices &amp; SEVF forms</div>
        <div className="text-sm text-slate-400 text-center py-8">Loading…</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 min-w-0">
      <div className="text-[15.5px] font-bold text-slate-900 mb-1">Invoices &amp; SEVF forms</div>
      <p className="text-xs text-slate-500 mb-4">Generated from session notes</p>
      {documents.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">No invoices or SEVF forms generated yet.</div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
          {documents.map((d) => {
            const tone = DOC_STATUS_TONE[d.status] || DOC_STATUS_TONE.pending;
            return (
              <div key={d.batchId} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3.5 py-2.5 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-slate-900 truncate">
                    {d.documentNumber} &middot; {d.documentType === 'sevf' ? 'SEVF' : 'Invoice'}
                  </div>
                  <div className="text-[11.5px] text-slate-500 truncate">
                    {d.practitionerName} &middot; {d.sessionCount} session{d.sessionCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[13.5px] font-bold text-slate-900 font-mono tabular-nums">{money(d.amount)}</span>
                  <span className={`text-[10.5px] font-bold px-2 py-1 rounded-full ${tone.bg} ${tone.text}`}>{tone.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire fetches into `CompanyDashboard`**

In the `CompanyDashboard` function, add state and fetches alongside the existing `pipeline`/`returnedLogs` pattern:

```javascript
  const [services, setServices] = useState(null);
  const [documents, setDocuments] = useState(null);
```

Add to the all-time-fetch `useEffect` (the one with `pipeline`/`returnedLogs`):

```javascript
    api.get('/api/dashboard/documents').then((res) => setDocuments(res.data.documents)).catch(() => setDocuments([]));
```

Add to the month-scoped `useEffect` (the one depending on `[monthValue]`), alongside the existing `month` fetch:

```javascript
    api.get('/api/dashboard/services', { params: { month: monthValue } })
      .then((res) => setServices(res.data))
      .catch(() => setServices(null));
```

Render both new sections in the JSX — add a new row after the "Who's submitting clean logs" section and before "Where this is headed":

```javascript
      <div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <ServicesBreakdown data={services} />
          <DocumentsFeed documents={documents} />
        </div>
      </div>
```

- [ ] **Step 4: Visual check**

Run: `cd frontend && npm run dev`, open Overview tab, confirm Services Provided tabs switch correctly and Documents feed renders with correct Matched/Pending/Mismatch chips.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CompanyDashboard.jsx
git commit -m "Add Services provided and Invoices & SEVF forms sections to Overview dashboard"
```

---

## Task 7: Customize / drag-to-reorder

**Files:**
- Modify: `frontend/src/components/CompanyDashboard.jsx` (add `DASHBOARD_SECTION_KEYS`, `useDashboardLayout`, `CustomizeToggle`, reorderable section wrapper; restructure the main render into the 5 grouped sections)

**Interfaces:**
- Consumes: `GET`/`PUT /api/dashboard/layout` (Task 1).
- Produces: none consumed elsewhere — this is the top-level `CompanyDashboard` export, the last task touching this file.

- [ ] **Step 1: Add the section-keys constant and layout hook**

Add near the top of `CompanyDashboard.jsx`, after the existing helper functions:

```javascript
// Must exactly match backend/src/controllers/dashboardController.js's
// DASHBOARD_SECTION_KEYS — the backend validates PUT /api/dashboard/layout
// against this same fixed set.
const DASHBOARD_SECTION_KEYS = ['pipeline_and_queue', 'services', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'];

function useDashboardLayout() {
  const [order, setOrder] = useState(DASHBOARD_SECTION_KEYS);
  useEffect(() => {
    api.get('/api/dashboard/layout')
      .then((res) => { if (res.data.sectionOrder) setOrder(res.data.sectionOrder); })
      .catch(() => {});
  }, []);

  const saveOrder = (newOrder) => {
    setOrder(newOrder);
    api.put('/api/dashboard/layout', { sectionOrder: newOrder }).catch((err) => console.error('Failed to save dashboard layout:', err));
  };

  return [order, saveOrder];
}
```

- [ ] **Step 2: Add `CustomizeToggle` and `DraggableSection`**

```javascript
function CustomizeToggle({ active, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
        active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {active ? 'Done' : 'Customize'}
    </button>
  );
}

function DraggableSection({ sectionKey, isCustomizing, onDragStart, onDragOver, onDrop, children }) {
  return (
    <div
      draggable={isCustomizing}
      onDragStart={isCustomizing ? (e) => onDragStart(e, sectionKey) : undefined}
      onDragOver={isCustomizing ? (e) => { e.preventDefault(); onDragOver(e, sectionKey); } : undefined}
      onDrop={isCustomizing ? (e) => onDrop(e, sectionKey) : undefined}
      className={isCustomizing ? 'relative ring-2 ring-dashed ring-slate-300 rounded-2xl p-1 cursor-grab active:cursor-grabbing' : ''}
    >
      {isCustomizing && (
        <div className="absolute -top-2.5 right-3 bg-slate-900 text-white rounded-full p-1 z-10">
          <GripVertical className="size-3" />
        </div>
      )}
      {children}
    </div>
  );
}
```

Add `GripVertical` to the existing `lucide-react` import at the top of the file.

- [ ] **Step 3: Restructure the main render into keyed, reorderable section blocks**

This step's `sectionsByKey.services` block supersedes the standalone `<ServicesBreakdown>`/`<DocumentsFeed>` row Task 6 Step 3 inserted directly into the return statement — that whole `<div>` block (the one Task 6 added between "Who's submitting clean logs" and "Where this is headed") is removed here, folded into `sectionsByKey` instead, not left in place alongside it.

Replace the `export function CompanyDashboard()` body's return statement. First add drag-state and handlers inside the function, then build a `sectionsByKey` map, then render via `order.map(...)`:

```javascript
  const [layoutOrder, saveLayoutOrder] = useDashboardLayout();
  const [isCustomizing, setIsCustomizing] = useState(false);
  const dragKeyRef = React.useRef(null);

  const handleDragStart = (e, key) => { dragKeyRef.current = key; };
  const handleDragOver = (e, overKey) => {
    const draggedKey = dragKeyRef.current;
    if (!draggedKey || draggedKey === overKey) return;
    const current = [...layoutOrder];
    const fromIdx = current.indexOf(draggedKey);
    const toIdx = current.indexOf(overKey);
    if (fromIdx === -1 || toIdx === -1) return;
    current.splice(fromIdx, 1);
    current.splice(toIdx, 0, draggedKey);
    saveLayoutOrder(current);
  };
  const handleDrop = () => { dragKeyRef.current = null; };

  const sectionsByKey = {
    pipeline_and_queue: (
      <div>
        <div className="text-lg font-bold text-slate-900 mb-1">From session to payment</div>
        <p className="text-sm text-slate-500 mb-4 max-w-2xl">Everything currently in the pipeline, and what's stuck along the way.</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-4 items-start">
          <BillingFunnel pipeline={pipeline} />
          <ActionQueue day={day} onSelectSession={setSelectedSessionId} />
        </div>
      </div>
    ),
    services: (
      <div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <ServicesBreakdown data={services} />
          <DocumentsFeed documents={documents} />
        </div>
      </div>
    ),
    accuracy_table: (
      <div>
        <div className="text-lg font-bold text-slate-900 mb-1">Who's submitting clean logs</div>
        <p className="text-sm text-slate-500 mb-4 max-w-2xl">Same month as above — sorted lowest accuracy first, so the practitioners most worth a conversation surface at the top.</p>
        <PractitionerAccuracyTable month={month} />
      </div>
    ),
    eims_status: (
      <div>
        <div className="text-lg font-bold text-slate-900 mb-1">EIMS match status</div>
        <p className="text-sm text-slate-500 mb-4 max-w-2xl">Reconciled against state records, all time.</p>
        <EimsDonut pipeline={pipeline} />
      </div>
    ),
    returned_logs_and_trajectory: (
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="text-lg font-bold text-slate-900">Where this is headed</div>
          <TrajectoryTabs active={trajectoryTab} onChange={setTrajectoryTab} />
        </div>
        <p className="text-sm text-slate-500 mb-4 max-w-2xl">Same work, three distances — the volume trend, and how it's reconciling against the state.</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
          {trajectoryTab === 'day' && <ReturnedLogsPanel returnedLogs={returnedLogs} onSelectSession={setSelectedSessionId} />}
          {trajectoryTab === 'month' && <MonthTrajectory month={month} monthValue={monthValue} onMonthChange={setMonthValue} />}
          {trajectoryTab === 'year' && <YearTrajectory />}
        </div>
      </div>
    ),
  };

  return (
    <div className="space-y-6">
      <VerdictBanner day={day} ap={ap} />

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-sm font-semibold text-slate-500">Viewing</div>
          <div className="flex items-center gap-2">
            <MonthYearPicker value={monthValue} onChange={setMonthValue} />
            <CustomizeToggle active={isCustomizing} onToggle={() => setIsCustomizing((v) => !v)} />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <StatCard
            icon={Tag} tone="teal" label="Ready to pay"
            value={month ? money(month.ap.totalClear) : '—'}
            deltaText={month && month.ap.totalOwed > 0 ? `${Math.round((month.ap.totalClear / month.ap.totalOwed) * 100)}% cleared · ${Math.round((month.ap.totalHeld / month.ap.totalOwed) * 100)}% held` : 'Nothing owed this month'}
            deltaTone="up"
          />
          <StatCard
            icon={Activity} tone="violet" label="Sessions this month"
            value={month ? month.volumeVsPriorMonth.current.toLocaleString() : '—'}
            deltaText="across the active roster"
            deltaTone="flat"
          />
          <StatCard
            icon={AlertTriangle} tone="amber" label="Needs a decision"
            value={month ? String(month.exceptions.on_hold) : '—'}
            deltaText={month && month.exceptions.on_hold > 0 ? 'see the queue below' : 'nothing flagged'}
            deltaTone={month && month.exceptions.on_hold > 0 ? 'down' : 'flat'}
          />
          <StatCard
            icon={CalendarClock} tone="rose" label="Paid this month"
            value={month ? String(month.paidCount) : '—'}
            deltaText={month && month.paidCount === 0 ? 'nothing paid yet' : 'sessions marked paid'}
            deltaTone="flat"
          />
        </div>
      </div>

      {layoutOrder.map((key) => (
        <DraggableSection
          key={key}
          sectionKey={key}
          isCustomizing={isCustomizing}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {sectionsByKey[key]}
        </DraggableSection>
      ))}

      <SessionDetailDialog assessmentId={selectedSessionId} onClose={() => setSelectedSessionId(null)} />
    </div>
  );
```

Also add `import React from 'react';`'s named import `useRef` — since the file already does `import React, { useState, useEffect } from 'react';`, change it to `import React, { useState, useEffect, useRef } from 'react';` and replace `React.useRef(null)` with `useRef(null)` for consistency with the rest of the file's import style.

- [ ] **Step 4: Visual check**

Run: `cd frontend && npm run dev`, open Overview tab, click Customize, drag a section card to a new position, confirm it persists after a page reload (re-fetches the saved order from `GET /api/dashboard/layout`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CompanyDashboard.jsx
git commit -m "Add Customize drag-to-reorder to Overview dashboard sections"
```

---

## Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npx jest`
Expected: PASS — all existing tests plus every new test from Tasks 1-3 green, no regressions.

- [ ] **Step 2: Manual verification checklist against real tenant data**

With the dev servers running (`backend`: `npm run dev` or equivalent; `frontend`: `npm run dev`), log in as a `master_reports`-permitted office-staff user and confirm:
- Hero banner shows the navy gradient with the right-aligned Cleared bar.
- Stat cards show small circular icon badges top-right.
- Billing pipeline shows thin teal bars with right-aligned values.
- "What needs you" rows show a right-aligned dollar amount.
- Services provided tabs switch between Service type/Status/Location/Discipline without a network refetch (Network tab shows one `/api/dashboard/services` call per month change, not per tab click).
- Invoices & SEVF forms shows a document per recent `billing_batches` row with a correct Matched/Pending/Mismatch chip.
- Practitioner accuracy table shows a discipline subtitle under each name.
- Clicking Customize reveals drag handles; dragging a section and reloading the page preserves the new order.
- A login WITHOUT `master_reports` permission gets 403 on `GET /api/dashboard/services`, `/documents`, and `/layout` (curl or a quick manual check with a non-admin login).

- [ ] **Step 3: Confirm no regressions in Day/Month/Year/AP logic**

Switch the `MonthYearPicker` across 2-3 different months and the Day/Month/Year trajectory tabs; confirm all values still match what Billing & Invoices' own Compliance Analysis/AP views show for the same data (same check the original dashboard plan's verification section specified).

---

## Deployment

- [ ] **Step 1: Apply the new migration to the production tenant DB(s)**

Run `backend/db/migrations/add_dashboard_layouts.sql` against each tenant database before deploying the backend code that references the new table (same order used for every prior migration in this project's history — schema first, then code).

- [ ] **Step 2: Deploy backend to Cloud Run**

```bash
cd backend
"/c/Users/ahsan/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd" run deploy njeis-backend --source . --region us-east1 --quiet
```

Verify: `curl -s -o /dev/null -w "%{http_code}\n" https://njeis-backend-996984273416.us-east1.run.app/health` returns `200`, and confirm a new revision actually landed (check the deploy output's revision name/timestamp).

- [ ] **Step 3: Deploy frontend to Vercel**

From the repo root (root dir is `frontend` per this project's Vercel project config):

```bash
npx vercel deploy --prod --yes
```

- [ ] **Step 4: Post-deploy smoke test**

Log into the production app as an office-staff user, open the Overview tab, confirm it loads without errors and the new sections render with real data.
