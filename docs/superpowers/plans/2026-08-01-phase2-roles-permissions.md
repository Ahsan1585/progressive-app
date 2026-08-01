# Phase 2 Role & Permission System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5 hardcoded `role` strings and scattered `requireRole([...])` allowlists with per-tenant, admin-editable named roles (Admin fixed/full-access + freely editable prebuilt/custom roles), each carrying a granular permission checklist that's enforced fresh on every request.

**Architecture:** Two new per-tenant tables (`roles`, `role_permissions`) plus a new nullable `practitioners.role_id` FK. A new `loadPermissions` middleware runs after `protect` on every authenticated request, resolving the caller's current role and permission set fresh from the database (never cached in the JWT, so edits and reassignments take effect on the very next request). `requirePermission(key)` replaces `requireRole([...])` at every route that previously checked one of the 3 retired fine-grained staff strings (`staff_director`/`billing`/`account_specialist`); routes that only ever checked `'ceo'` are untouched, because `'ceo'` remains the literal, unchanged value for the fixed Admin role.

**Tech Stack:** Node.js/Express, PostgreSQL (`pg`), React/Vite (Tailwind), no existing automated test framework in this repo (confirmed: no `jest`/`mocha`/`vitest` in `backend/package.json`, zero `*.test.js` files) — this plan follows the project's existing convention of `node --check` for syntax verification plus manual curl/script-based verification against a running dev server, matching how Phase 1 was verified.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-01-phase2-roles-permissions-design.md` — every task below implements one section of it.
- Practitioner-role accounts are completely out of scope — `role = 'practitioner'` and every check against it stays untouched.
- The Admin role is fixed and non-editable: `is_system = true`, always resolves to every permission, cannot be renamed/deleted/have its permissions changed via the API.
- Permission/role changes take effect on the very next request — no JWT caching of permissions or role_id.
- Progressive Steps NJ's existing 3 office roles must map onto equivalent permission sets automatically at migration time so no existing staff member's access changes (exact mapping is in Task 1).
- New tenants (post-deploy signups) get the true minimal default: only `staff_directory_view` on the 4 prebuilt non-Admin roles.
- The 13-key permission catalog is fixed for this phase (see Task 2) — do not invent new keys mid-plan; if a route doesn't map cleanly, use `requireOfficeStaff` (any non-practitioner role) instead, per the decisions in Task 6/7.

---

## File Structure

New files:
- `backend/db/migrations/add_roles_permissions.sql` — schema + backfill migration
- `backend/src/constants/permissions.js` — permission catalog + prebuilt-role default maps
- `backend/src/controllers/roleController.js` — CRUD for roles
- `backend/src/routes/roleRoutes.js` — `/api/roles` routes
- `frontend/src/pages/RoleManagement.jsx` — new admin tab UI

Modified files:
- `backend/db/migrations/index.js` — register new migration
- `backend/src/middleware/authMiddleware.js` — add `loadPermissions`, `requirePermission`, `requireOfficeStaff`
- `backend/index.js` — mount `roleRoutes`, apply `loadPermissions`, fix L399 inconsistent guard
- `backend/src/routes/authRoutes.js`, `billingRoutes.js`, `companyRoutes.js`, `dropdownOptionsRoutes.js`, `auditLogRoutes.js`, `subscriptionRoutes.js`, `reportRoutes.js`, `messageRoutes.js` — swap retired-string `requireRole` calls for `requirePermission`/`requireOfficeStaff`
- `backend/src/controllers/authController.js` — centralize the staff_director/account_specialist-can-only-touch-practitioners restriction into a permission-driven check; `updateStaffRole` becomes role_id-based; add `getMe`
- `backend/src/controllers/signupController.js` — seed a new tenant's Admin + 4 prebuilt roles
- `frontend/src/pages/AdminDashboard.jsx` — replace `TAB_ACCESS`/`ROLE_LABELS` with permission-driven tab visibility fetched from `/api/auth/me`
- `frontend/src/components/RegisterPractitionerForm.jsx` — role dropdown populated from `GET /api/roles` instead of hardcoded 5-value list

---

### Task 1: Migration — roles/role_permissions tables, role_id column, backfill

**Files:**
- Create: `backend/db/migrations/add_roles_permissions.sql`
- Modify: `backend/db/migrations/index.js`

**Interfaces:**
- Produces: `roles` table (`id uuid`, `name text`, `is_system boolean`, `created_at`, `updated_at`), `role_permissions` table (`role_id uuid`, `permission_key text`), `practitioners.role_id uuid` column. These are what every later task's queries reference.

- [ ] **Step 1: Write the migration SQL**

```sql
-- backend/db/migrations/add_roles_permissions.sql
--
-- Phase 2: replaces the 3 fine-grained hardcoded office-staff role strings
-- (staff_director/billing/account_specialist) with per-tenant, admin-editable
-- named roles + a granular permission checklist. 'ceo' and 'practitioner'
-- keep their existing meaning and are untouched by this migration.
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_roles_permissions.sql

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id);

-- Widen the legacy role check: the 3 fine-grained strings collapse into
-- one 'staff' catch-all; 'ceo' and 'practitioner' are unchanged.
ALTER TABLE practitioners DROP CONSTRAINT IF EXISTS practitioners_role_check;
ALTER TABLE practitioners ADD CONSTRAINT practitioners_role_check
  CHECK (role = ANY (ARRAY['practitioner'::text, 'ceo'::text, 'staff'::text]));

-- Seed the fixed Admin role (is_system = true; "all permissions" comes from
-- the is_system flag at query time, not enumeration in role_permissions).
INSERT INTO roles (name, is_system)
  SELECT 'Admin', true
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE is_system = true);

-- Seed the 4 prebuilt labels with the true minimal default (staff_directory_view
-- only). For a brand-new tenant this is exactly what they should start with.
-- For an existing tenant with real staff already assigned to the 3 retired
-- role strings, the backfill block below OVERWRITES these to the
-- behavior-preserving set instead, so no double-seeding conflict occurs.
INSERT INTO roles (name)
  SELECT v.name FROM (VALUES ('Account Specialist'), ('Billing Specialist'), ('Program Coordinator'), ('Staff Director')) AS v(name)
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE roles.name = v.name);

INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, 'staff_directory_view' FROM roles r
  WHERE r.name IN ('Account Specialist', 'Billing Specialist', 'Program Coordinator', 'Staff Director')
  ON CONFLICT DO NOTHING;

-- Behavior-preserving backfill for an existing tenant's real staff: only
-- runs meaningfully if practitioners.role currently holds one of the 3
-- retired values (a brand-new tenant has none, so this is a no-op there).
-- Overwrite 'Staff Director' role's permissions to match today's
-- staff_director requireRole guards exactly.
DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'Staff Director')
  AND EXISTS (SELECT 1 FROM practitioners WHERE role = 'staff_director');
INSERT INTO role_permissions (role_id, permission_key)
  SELECT (SELECT id FROM roles WHERE name = 'Staff Director'), key
  FROM unnest(ARRAY['staff_directory_view', 'staff_directory_edit', 'staff_directory_edit_role', 'register_new_user']) AS key
  WHERE EXISTS (SELECT 1 FROM practitioners WHERE role = 'staff_director')
  ON CONFLICT DO NOTHING;

-- Overwrite 'Billing Specialist' role's permissions to match today's
-- 'billing' requireRole guards exactly.
DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'Billing Specialist')
  AND EXISTS (SELECT 1 FROM practitioners WHERE role = 'billing');
INSERT INTO role_permissions (role_id, permission_key)
  SELECT (SELECT id FROM roles WHERE name = 'Billing Specialist'), key
  FROM unnest(ARRAY['billing_pending', 'billing_completed', 'billing_invoice_status']) AS key
  WHERE EXISTS (SELECT 1 FROM practitioners WHERE role = 'billing')
  ON CONFLICT DO NOTHING;

-- Overwrite 'Account Specialist' role's permissions to match today's
-- 'account_specialist' requireRole guards exactly.
DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'Account Specialist')
  AND EXISTS (SELECT 1 FROM practitioners WHERE role = 'account_specialist');
INSERT INTO role_permissions (role_id, permission_key)
  SELECT (SELECT id FROM roles WHERE name = 'Account Specialist'), key
  FROM unnest(ARRAY['staff_directory_view', 'staff_directory_edit', 'register_new_user', 'billing_pending', 'billing_completed', 'billing_invoice_status']) AS key
  WHERE EXISTS (SELECT 1 FROM practitioners WHERE role = 'account_specialist')
  ON CONFLICT DO NOTHING;

-- Point every existing practitioner row at its matching seeded role.
UPDATE practitioners SET role_id = (SELECT id FROM roles WHERE name = 'Admin') WHERE role = 'ceo' AND role_id IS NULL;
UPDATE practitioners SET role_id = (SELECT id FROM roles WHERE name = 'Staff Director') WHERE role = 'staff_director' AND role_id IS NULL;
UPDATE practitioners SET role_id = (SELECT id FROM roles WHERE name = 'Billing Specialist') WHERE role = 'billing' AND role_id IS NULL;
UPDATE practitioners SET role_id = (SELECT id FROM roles WHERE name = 'Account Specialist') WHERE role = 'account_specialist' AND role_id IS NULL;

-- Finally, collapse the 3 retired literal values down to the 'staff'
-- catch-all now that role_id carries the real distinction.
UPDATE practitioners SET role = 'staff' WHERE role IN ('staff_director', 'billing', 'account_specialist');
```

- [ ] **Step 2: Register the migration**

Edit `backend/db/migrations/index.js`, add the new filename as the last entry:

```js
const MIGRATIONS = [
  'add_subscription_billing.sql',
  'add_dropdown_options.sql',
  'add_compliance_learning.sql',
  'fix_zero_time_logs.sql',
  'add_eims_missing_approval.sql',
  'add_eims_missing_approval_workflow.sql',
  'add_invoice_overdue_status.sql',
  'add_roles_permissions.sql',
];

module.exports = { MIGRATIONS };
```

- [ ] **Step 3: Syntax-check the SQL locally against a throwaway database**

This project has no test framework, so verify by applying the migration to a scratch database (not production) and inspecting the result:

```bash
createdb phase2_migration_check
psql phase2_migration_check -f backend/db/schema.sql
psql phase2_migration_check -c "INSERT INTO practitioners (first_name, last_name, email, password_hash, role) VALUES ('Test','StaffDir','sd@test.local','x','staff_director'), ('Test','Billing','b@test.local','x','billing'), ('Test','AcctSpec','as@test.local','x','account_specialist'), ('Test','Ceo','c@test.local','x','ceo')"
psql phase2_migration_check -f backend/db/migrations/add_roles_permissions.sql
psql phase2_migration_check -c "SELECT r.name, array_agg(rp.permission_key) FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.name ORDER BY r.name"
psql phase2_migration_check -c "SELECT role, role_id FROM practitioners"
dropdb phase2_migration_check
```

Expected: 'Admin' has no rows in `role_permissions` (its access comes from `is_system`, not enumeration) — every other role shows exactly the permission arrays listed in the migration comments. Every practitioner's `role_id` is non-null and every `role` column value is now one of `ceo`/`practitioner`/`staff`.

- [ ] **Step 4: Commit**

```bash
git add backend/db/migrations/add_roles_permissions.sql backend/db/migrations/index.js
git commit -m "Add roles/role_permissions tables and behavior-preserving backfill migration"
```

---

### Task 2: Permission catalog constant module

**Files:**
- Create: `backend/src/constants/permissions.js`

**Interfaces:**
- Produces: `PERMISSION_KEYS` (array of the 13 valid keys), `PREBUILT_ROLE_NAMES` (array of the 4 non-Admin prebuilt names), used by `roleController.js` (Task 4) to validate incoming permission keys and by `signupController.js` (Task 8) to seed new tenants.

- [ ] **Step 1: Write the module**

```js
// backend/src/constants/permissions.js
//
// The fixed 13-key permission catalog for Phase 2's role system. Adding a
// new permission key requires updating this list AND adding a matching
// requirePermission(...) call at whatever route it's meant to guard —
// neither alone is sufficient.
const PERMISSION_KEYS = [
  'staff_directory_view',
  'staff_directory_edit',
  'staff_directory_edit_role',
  'register_new_user',
  'master_reports',
  'billing_pending',
  'billing_completed',
  'billing_invoice_status',
  'subscription_billing',
  'company_info_compliance_doc',
  'company_info_dropdown_options',
  'audit_logs',
  'action_required_approve',
];

// The 4 prebuilt, freely-editable role labels seeded for every tenant
// (in addition to the fixed, non-editable 'Admin' role). Both a brand-new
// tenant's signup provisioning (signupController.js) and the historical
// migration backfill (add_roles_permissions.sql) rely on these exact names.
const PREBUILT_ROLE_NAMES = ['Account Specialist', 'Billing Specialist', 'Program Coordinator', 'Staff Director'];

module.exports = { PERMISSION_KEYS, PREBUILT_ROLE_NAMES };
```

- [ ] **Step 2: Verify syntax**

Run: `node --check backend/src/constants/permissions.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add backend/src/constants/permissions.js
git commit -m "Add shared permission-key catalog constant"
```

---

### Task 3: Auth middleware — loadPermissions, requirePermission, requireOfficeStaff

**Files:**
- Modify: `backend/src/middleware/authMiddleware.js`

**Interfaces:**
- Consumes: `pool` from `backend/src/config/db.js` (the tenant-scoped Proxy — safe to use here since `loadPermissions` always runs after `protect` has already called `runWithTenant`).
- Produces: `loadPermissions` (middleware, sets `req.permissions` to a `Set<string>` and `req.isAdmin` to a boolean), `requirePermission(key)` (route guard factory), `requireOfficeStaff` (route guard: passes for any role other than `'practitioner'`). All three are consumed by every route-file task below (5, 6, 7).

- [ ] **Step 1: Add the new exports to authMiddleware.js**

Insert after the existing `protect` function and before `requireRole` (keep `requireRole` — it's still used for the handful of `['ceo']`-only routes untouched by this plan):

```js
const { pool } = require('../config/db');

const loadPermissions = (req, res, next) => {
  if (req.practitioner.role === 'ceo') {
    req.isAdmin = true;
    req.permissions = new Set();
    return next();
  }
  if (req.practitioner.role === 'practitioner') {
    req.isAdmin = false;
    req.permissions = new Set();
    return next();
  }
  pool
    .query(
      `SELECT r.is_system, COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS keys
       FROM practitioners p
       JOIN roles r ON r.id = p.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE p.id = $1
       GROUP BY r.is_system`,
      [req.practitioner.practitionerId]
    )
    .then(({ rows }) => {
      const row = rows[0];
      req.isAdmin = Boolean(row?.is_system);
      req.permissions = new Set(row?.keys || []);
      next();
    })
    .catch(next);
};

const requirePermission = (key) => (req, res, next) => {
  if (req.isAdmin || req.permissions?.has(key)) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
};

const requireOfficeStaff = (req, res, next) => {
  if (req.practitioner?.role === 'practitioner') {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  next();
};
```

Update the final `module.exports` line:

```js
module.exports = { protect, requireRole, loadPermissions, requirePermission, requireOfficeStaff };
```

- [ ] **Step 2: Wire loadPermissions in immediately after protect**

Edit `backend/index.js` where `protect` is imported (near L2):

```js
const { protect, requireRole, loadPermissions, requirePermission, requireOfficeStaff } = require('./src/middleware/authMiddleware');
```

`loadPermissions` is applied per-route (alongside `protect`) rather than globally, matching the existing pattern where `protect` itself is applied per-route/per-router, not as one `app.use(protect)` — this is handled inside each route file's own `router.use(protect)` line by appending `router.use(protect, loadPermissions)` (done per-file in Tasks 5–7, not here).

- [ ] **Step 3: Verify syntax**

Run: `node --check backend/src/middleware/authMiddleware.js && node --check backend/index.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/authMiddleware.js backend/index.js
git commit -m "Add loadPermissions/requirePermission/requireOfficeStaff middleware"
```

---

### Task 4: Role management controller + routes

**Files:**
- Create: `backend/src/controllers/roleController.js`
- Create: `backend/src/routes/roleRoutes.js`
- Modify: `backend/index.js` (mount the router)

**Interfaces:**
- Consumes: `PERMISSION_KEYS` from Task 2, `requirePermission`/`requireOfficeStaff` from Task 3, `pool` from `backend/src/config/db.js`.
- Produces: `GET/POST/PATCH/DELETE /api/roles` — consumed by the frontend Role Management tab (Task 10) and the staff-registration role dropdown (Task 11).

- [ ] **Step 1: Write roleController.js**

```js
// backend/src/controllers/roleController.js
const { pool } = require('../config/db');
const { PERMISSION_KEYS } = require('../constants/permissions');

async function listRoles(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.is_system, COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id
       ORDER BY r.is_system DESC, r.name ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

function validatePermissionKeys(keys) {
  if (!Array.isArray(keys)) return false;
  return keys.every((k) => PERMISSION_KEYS.includes(k));
}

async function createRole(req, res, next) {
  const { name, permissions } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Role name is required.' });
  }
  if (!validatePermissionKeys(permissions || [])) {
    return res.status(400).json({ error: 'One or more permission keys are invalid.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO roles (name) VALUES ($1) RETURNING id, name, is_system', [name.trim()]);
    const role = rows[0];
    for (const key of permissions || []) {
      await client.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [role.id, key]);
    }
    await client.query('COMMIT');
    res.status(201).json({ ...role, permissions: permissions || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A role with that name already exists.' });
    }
    next(err);
  } finally {
    client.release();
  }
}

async function updateRole(req, res, next) {
  const { id } = req.params;
  const { name, permissions } = req.body;
  const { rows: existingRows } = await pool.query('SELECT is_system FROM roles WHERE id = $1', [id]);
  if (!existingRows[0]) {
    return res.status(404).json({ error: 'Role not found.' });
  }
  if (existingRows[0].is_system) {
    return res.status(400).json({ error: 'The Admin role cannot be edited.' });
  }
  if (permissions !== undefined && !validatePermissionKeys(permissions)) {
    return res.status(400).json({ error: 'One or more permission keys are invalid.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (name) {
      await client.query('UPDATE roles SET name = $1, updated_at = now() WHERE id = $2', [name.trim(), id]);
    }
    if (permissions !== undefined) {
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
      for (const key of permissions) {
        await client.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [id, key]);
      }
    }
    await client.query('COMMIT');
    res.json({ id, name, permissions });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A role with that name already exists.' });
    }
    next(err);
  } finally {
    client.release();
  }
}

async function deleteRole(req, res, next) {
  const { id } = req.params;
  try {
    const { rows: existingRows } = await pool.query('SELECT is_system FROM roles WHERE id = $1', [id]);
    if (!existingRows[0]) {
      return res.status(404).json({ error: 'Role not found.' });
    }
    if (existingRows[0].is_system) {
      return res.status(400).json({ error: 'The Admin role cannot be deleted.' });
    }
    const { rows: inUse } = await pool.query('SELECT COUNT(*)::int AS count FROM practitioners WHERE role_id = $1', [id]);
    if (inUse[0].count > 0) {
      return res.status(409).json({ error: 'Reassign every staff member off this role before deleting it.' });
    }
    await pool.query('DELETE FROM roles WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listRoles, createRole, updateRole, deleteRole };
```

- [ ] **Step 2: Write roleRoutes.js**

```js
// backend/src/routes/roleRoutes.js
const express = require('express');
const { protect, loadPermissions, requirePermission, requireOfficeStaff } = require('../middleware/authMiddleware');
const { listRoles, createRole, updateRole, deleteRole } = require('../controllers/roleController');

const router = express.Router();
router.use(protect, loadPermissions);

// Any office staff member can read the role list (needed to populate the
// "assign role" dropdown even for someone who can't manage roles themselves).
router.get('/', requireOfficeStaff, listRoles);

router.post('/', requirePermission('staff_directory_edit_role'), createRole);
router.patch('/:id', requirePermission('staff_directory_edit_role'), updateRole);
router.delete('/:id', requirePermission('staff_directory_edit_role'), deleteRole);

module.exports = router;
```

- [ ] **Step 3: Mount the router**

Edit `backend/index.js`: add near the other route requires (after L30's `platformAdminRoutes` require):

```js
const roleRoutes = require('./src/routes/roleRoutes');
```

And near L86 (after `app.use('/api/platform', platformAdminRoutes)`):

```js
app.use('/api/roles', roleRoutes);
```

- [ ] **Step 4: Verify syntax**

Run: `node --check backend/src/controllers/roleController.js && node --check backend/src/routes/roleRoutes.js && node --check backend/index.js`
Expected: no output.

- [ ] **Step 5: Manual verification against a running dev server**

Start the backend locally against the scratch database from Task 1 (or a real dev tenant), log in as an Admin/ceo account, then:

```bash
TOKEN="<jwt from login>"
curl -s http://localhost:8080/api/roles -H "Authorization: Bearer $TOKEN" | head -c 2000
curl -s -X POST http://localhost:8080/api/roles -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Front Desk Lead","permissions":["staff_directory_view"]}'
```

Expected: the GET lists Admin (empty `permissions` array, since access comes from `is_system`) plus the 4 prebuilt roles with their backfilled or default permissions; the POST returns 201 with the new role. Then confirm deleting the fixed Admin role is rejected:

```bash
ADMIN_ID=$(curl -s http://localhost:8080/api/roles -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).find(r=>r.is_system).id))")
curl -s -X DELETE http://localhost:8080/api/roles/$ADMIN_ID -H "Authorization: Bearer $TOKEN"
```

Expected: `400 { "error": "The Admin role cannot be deleted." }`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/roleController.js backend/src/routes/roleRoutes.js backend/index.js
git commit -m "Add role management CRUD API"
```

---

### Task 5: authRoutes.js guard rewrite + authController.js changes

**Files:**
- Modify: `backend/src/routes/authRoutes.js`
- Modify: `backend/src/controllers/authController.js`

**Interfaces:**
- Consumes: `requirePermission`, `requireOfficeStaff`, `loadPermissions` from Task 3.
- Produces: `GET /api/auth/me` (new) returning `{ isAdmin, permissions: string[] }` — consumed by the frontend in Tasks 9–10.

- [ ] **Step 1: Rewrite the 7 affected guards in authRoutes.js**

Replace each of these lines (matching the exact routes found during exploration):

```js
// Before:
router.post('/register-practitioner', protect, requireRole(['ceo', 'staff_director', 'account_specialist']), provisionPractitioner);
router.get('/staff', protect, requireRole(['ceo', 'staff_director', 'account_specialist']), getStaff);
router.patch('/staff/:id', protect, requireRole(['ceo', 'staff_director', 'account_specialist']), updateStaffProfile);
router.patch('/staff/:id/role', protect, requireRole(['ceo']), updateStaffRole);
router.delete('/staff/:id', protect, requireRole(['ceo']), deleteStaffMember);
router.patch('/staff/:id/reactivate', protect, requireRole(['ceo']), reactivateStaffMember);
router.post('/staff/:id/contact-request', protect, requireRole(['ceo', 'staff_director', 'account_specialist']), sendContactRequest);

// After:
router.post('/register-practitioner', protect, loadPermissions, requirePermission('register_new_user'), provisionPractitioner);
router.get('/staff', protect, loadPermissions, requirePermission('staff_directory_view'), getStaff);
router.patch('/staff/:id', protect, loadPermissions, requirePermission('staff_directory_edit'), updateStaffProfile);
router.patch('/staff/:id/role', protect, loadPermissions, requirePermission('staff_directory_edit_role'), updateStaffRole);
router.delete('/staff/:id', protect, loadPermissions, requirePermission('staff_directory_edit_role'), deleteStaffMember);
router.patch('/staff/:id/reactivate', protect, loadPermissions, requirePermission('staff_directory_edit_role'), reactivateStaffMember);
router.post('/staff/:id/contact-request', protect, loadPermissions, requirePermission('staff_directory_edit'), sendContactRequest);
```

Update the top-of-file import to include the new middleware:

```js
const { protect, requireRole, loadPermissions, requirePermission } = require('../middleware/authMiddleware');
```

Add the new route (near the other `protect`-only routes, e.g. after `company-status`):

```js
router.get('/me', protect, loadPermissions, getMe);
```

And import `getMe` alongside the other controller imports.

- [ ] **Step 2: Add getMe and rewrite the inline role restriction in authController.js**

The restriction "staff_director/account_specialist can only touch practitioner accounts" is currently duplicated as an inline `.includes(req.practitioner.role)` check in two places (`provisionPractitioner` L62-64, `updateStaffProfile` L481-483). Since those two literal role strings no longer exist, replace both blocks with a permission-driven equivalent: anyone who does NOT have `staff_directory_edit_role` may only create/edit `practitioner`-role targets (this preserves today's exact behavior — only the old ceo-equivalent tier could manage non-practitioner accounts).

In `provisionPractitioner`, replace:

```js
if (['staff_director', 'account_specialist'].includes(req.practitioner.role) && role !== 'practitioner') {
  return res.status(403).json({ error: 'Office Managers and Account Specialists can only register Practitioner accounts.' });
}
```

with:

```js
if (!req.isAdmin && !req.permissions.has('staff_directory_edit_role') && role !== 'practitioner') {
  return res.status(403).json({ error: 'You can only register Practitioner accounts.' });
}
```

In `updateStaffProfile`, replace the equivalent block (L481-483) the same way, substituting `target.role` for the role-of-target check — note `target.role` is now `'ceo'`/`'practitioner'`/`'staff'`, so this specific check should compare against whether the target is a practitioner, which is unaffected by the role-string collapse:

```js
if (!req.isAdmin && !req.permissions.has('staff_directory_edit_role') && target.role !== 'practitioner') {
  return res.status(403).json({ error: 'You can only edit Practitioner accounts.' });
}
```

Rewrite `updateStaffRole` (L544-558) to accept and set `role_id` instead of a `role` string, since role assignment is now "pick one of this tenant's roles" rather than "pick one of 5 hardcoded strings." Replace the body's validation and update query:

```js
async function updateStaffRole(req, res, next) {
  const { id } = req.params;
  const { roleId } = req.body;
  try {
    const { rows: roleRows } = await pool.query('SELECT id, is_system FROM roles WHERE id = $1', [roleId]);
    if (!roleRows[0]) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    const legacyRole = roleRows[0].is_system ? 'ceo' : 'staff';
    await pool.query('UPDATE practitioners SET role = $1, role_id = $2 WHERE id = $3', [legacyRole, roleId, id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
```

(This assumes `updateStaffRole` never targets a `practitioner`-role account — confirmed true today since `authRoutes.js`'s staff endpoints are only ever used for office accounts in the existing UI; no behavior change here.)

Add `getMe` near the other simple handlers:

```js
async function getMe(req, res) {
  res.json({ isAdmin: req.isAdmin, permissions: Array.from(req.permissions) });
}
```

Add `getMe` to the file's `module.exports`.

- [ ] **Step 3: Verify syntax**

Run: `node --check backend/src/routes/authRoutes.js && node --check backend/src/controllers/authController.js`
Expected: no output.

- [ ] **Step 4: Manual verification**

```bash
TOKEN="<jwt from a staff-director-turned-'staff' login, per Task 1 backfill>"
curl -s http://localhost:8080/api/auth/me -H "Authorization: Bearer $TOKEN"
```

Expected: `{"isAdmin":false,"permissions":["staff_directory_view","staff_directory_edit","staff_directory_edit_role","register_new_user"]}` — matching the Task 1 backfill mapping exactly, confirming the migration and the new middleware agree.

```bash
curl -s http://localhost:8080/api/auth/staff -H "Authorization: Bearer $TOKEN"
```

Expected: 200 (this account has `staff_directory_view`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/authRoutes.js backend/src/controllers/authController.js
git commit -m "Rewrite authRoutes guards to permission-based checks; add GET /api/auth/me"
```

---

### Task 6: billingRoutes.js guard rewrite

**Files:**
- Modify: `backend/src/routes/billingRoutes.js`

**Interfaces:**
- Consumes: `requirePermission` from Task 3.

- [ ] **Step 1: Replace billingGuard with two split guards**

The current `billingGuard = requireRole(['ceo', 'billing', 'account_specialist'])` (L43) is applied uniformly to 20 routes that actually span two different sub-tab permissions per the spec. Replace the single guard with two, and reassign each route to the correct one:

```js
// Before:
const billingGuard = requireRole(['ceo', 'billing', 'account_specialist']);

// After:
const pendingGuard = requirePermission('billing_pending');
const completedGuard = requirePermission('billing_completed');
```

Apply `pendingGuard` to: `GET /pending-logs`, `GET /practitioner-logs`, `GET /log-notes`, `GET /compliance-analysis`, `POST /compliance-analysis/allow-field`, `GET /compliance-learned-matches`, `DELETE /compliance-learned-matches/:id`, `GET /compliance-analysis/session-status`, `POST /compliance-analysis/send-missing-to-admin`, `PATCH /log-status`, `POST /reject-log`, `POST /reconcile-log`, `POST /log-comment`, `POST /generate-njeis`, `POST /generate-invoice`, `POST /complete-billing`, `POST /practitioner/:id/lock`, `POST /practitioner/:id/unlock`.

Apply `completedGuard` to: `GET /history`, `GET /download`, `GET /vault-logs`, `GET /batches`, `POST /revert-batch`.

Replace `invoiceStatusWriteGuard = requireRole(['ceo', 'account_specialist'])` (L48) with:

```js
const invoiceStatusWriteGuard = requirePermission('billing_invoice_status');
```

(applies unchanged to `PATCH /batch/:id/printed`, `PATCH /batch/:id/paid`).

Replace the `action-required` guards (currently `requireRole(['ceo'])` at L70-71) with:

```js
router.get('/action-required', protect, loadPermissions, requirePermission('action_required_approve'), getActionRequired);
router.post('/action-required/decide', protect, loadPermissions, requirePermission('action_required_approve'), decideActionRequired);
```

Leave `PUT /compliance-strictness` (`requireRole(['ceo'])`, L64) exactly as-is — per the spec, this stays a hardcoded Admin-exclusive policy lever, not a checkbox permission, and `'ceo'` remains valid.

Update the file's top import to add `loadPermissions, requirePermission` alongside the existing `protect, requireRole` import, and ensure `router.use(protect, loadPermissions)` (or the per-route equivalent) precedes every `requirePermission(...)` call — follow whatever pattern (router-level `.use` vs. per-route) the file already uses for `protect`.

- [ ] **Step 2: Verify syntax**

Run: `node --check backend/src/routes/billingRoutes.js`
Expected: no output.

- [ ] **Step 3: Manual verification**

```bash
BILLING_TOKEN="<jwt for the migrated 'Billing Specialist' account>"
curl -s http://localhost:8080/api/billing/pending-logs -H "Authorization: Bearer $BILLING_TOKEN"
curl -s http://localhost:8080/api/billing/history -H "Authorization: Bearer $BILLING_TOKEN"
curl -s http://localhost:8080/api/billing/action-required -H "Authorization: Bearer $BILLING_TOKEN"
```

Expected: first two return 200 (this role has `billing_pending`+`billing_completed` per the Task 1 backfill), third returns 403 (no `action_required_approve` — that stayed ceo-only historically, and the Billing Specialist role was never granted it in the backfill).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/billingRoutes.js
git commit -m "Split billingRoutes guard into billing_pending/completed/invoice_status/action_required permissions"
```

---

### Task 7: Remaining route files — company, dropdown-options, audit-log, subscription, report, message, index.js L399

**Files:**
- Modify: `backend/src/routes/companyRoutes.js`
- Modify: `backend/src/routes/dropdownOptionsRoutes.js`
- Modify: `backend/src/routes/auditLogRoutes.js`
- Modify: `backend/src/routes/subscriptionRoutes.js`
- Modify: `backend/src/routes/reportRoutes.js`
- Modify: `backend/src/routes/messageRoutes.js`
- Modify: `backend/index.js` (L399 inline route)

**Interfaces:**
- Consumes: `requirePermission`, `requireOfficeStaff` from Task 3.

- [ ] **Step 1: companyRoutes.js**

Split the existing two guards. `readGuard = requireRole(['ceo', 'staff_director', 'billing', 'account_specialist'])` (L19, applied to `GET /` and `GET /compliance-doc/download`) becomes `requireOfficeStaff` — this is a literal behavior-preserving translation (today's guard already means "any non-practitioner role"; `requireOfficeStaff` is that check expressed against the new role model instead of the retired literal strings).

`writeGuard = requireRole(['ceo'])` (L22) currently covers 6 routes that the spec splits into two tiers. Keep branding/logo ceo-only (unchanged, `'ceo'` string still valid):

```js
const brandingWriteGuard = requireRole(['ceo']); // PUT /, PUT /logo — stays Admin-exclusive per spec
const complianceDocGuard = requirePermission('company_info_compliance_doc'); // PUT /compliance-doc, GET /compliance-doc/mapping, POST /compliance-doc/apply-mapping, DELETE /compliance-doc
```

Apply `brandingWriteGuard` to `PUT /` and `PUT /logo`; apply `complianceDocGuard` to `PUT /compliance-doc`, `GET /compliance-doc/mapping`, `POST /compliance-doc/apply-mapping`, `DELETE /compliance-doc`.

- [ ] **Step 2: dropdownOptionsRoutes.js**

`writeGuard = requireRole(['ceo'])` (L18, covering `POST /`, `PUT /:id`, `DELETE /:id`, `PUT /:id/reactivate`) becomes:

```js
const writeGuard = requirePermission('company_info_dropdown_options');
```

`GET /` stays `protect`-only (unchanged — dropdown reads were already open to any authenticated user, including practitioners, since forms need them).

- [ ] **Step 3: auditLogRoutes.js**

```js
// Before:
router.get('/', protect, requireRole(['ceo']), getAuditLog);
// After:
router.get('/', protect, loadPermissions, requirePermission('audit_logs'), getAuditLog);
```

- [ ] **Step 4: subscriptionRoutes.js**

```js
// Before:
const ceoOnly = requireRole(['ceo']);
// After:
const ceoOnly = requirePermission('subscription_billing');
```

(Variable name kept as `ceoOnly` for minimal diff noise, even though it now checks a permission — Admin/`'ceo'` still always passes via `req.isAdmin`.) Leave the two unguarded Cloud Scheduler cron routes (`run-scheduled`, `mark-overdue`) untouched.

- [ ] **Step 5: reportRoutes.js**

```js
// Before:
const ceoGuard = requireRole(['ceo']);
// After:
const ceoGuard = requirePermission('master_reports');
```

Applied unchanged to all 8 existing routes.

- [ ] **Step 6: messageRoutes.js**

```js
// Before:
const officeGuard = requireRole(['ceo', 'staff_director', 'billing', 'account_specialist']);
// After:
const officeGuard = requireOfficeStaff;
```

Applied unchanged to `GET /threads`. Leave `messageController.js`'s inline `req.practitioner.role === 'practitioner'` checks (L9, L115) completely untouched — `'practitioner'` is still a valid, unchanged literal, so this logic needs no change.

- [ ] **Step 7: backend/index.js L399**

This route currently has the one inconsistent guard in the whole codebase (`requireRole(['ceo', 'staff_director'])` for the admin NJEIS PDF route, while the equivalent routes in `reportRoutes.js` are ceo-only). Resolve the inconsistency by treating it the same as the rest of Master Reports:

```js
// Before:
app.get('/api/admin/reports/njeis-form', protect, requireRole(['ceo', 'staff_director']), ...);
// After:
app.get('/api/admin/reports/njeis-form', protect, loadPermissions, requirePermission('master_reports'), ...);
```

- [ ] **Step 8: Verify syntax across all 6 files**

Run: `node --check backend/src/routes/companyRoutes.js && node --check backend/src/routes/dropdownOptionsRoutes.js && node --check backend/src/routes/auditLogRoutes.js && node --check backend/src/routes/subscriptionRoutes.js && node --check backend/src/routes/reportRoutes.js && node --check backend/src/routes/messageRoutes.js && node --check backend/index.js`
Expected: no output.

- [ ] **Step 9: Manual verification**

```bash
STAFF_DIR_TOKEN="<jwt for the migrated 'Staff Director' account>"
curl -s http://localhost:8080/api/company -H "Authorization: Bearer $STAFF_DIR_TOKEN"
curl -s http://localhost:8080/api/reports/pending -H "Authorization: Bearer $STAFF_DIR_TOKEN"
curl -s http://localhost:8080/api/admin/reports/njeis-form -H "Authorization: Bearer $STAFF_DIR_TOKEN"
```

Expected: first returns 200 (requireOfficeStaff passes for any non-practitioner), second and third return 403 — Staff Director was never granted `master_reports` in the Task 1 backfill (matching today's actual behavior, where staff_director historically could NOT reach `reportRoutes.js`'s ceo-only routes; L399's route is the one that's changing on purpose to close the inconsistency, so a former staff_director losing access to that one specific route is an intentional, spec-noted fix, not a regression to the other 7 report routes which were already ceo-only).

- [ ] **Step 10: Commit**

```bash
git add backend/src/routes/companyRoutes.js backend/src/routes/dropdownOptionsRoutes.js backend/src/routes/auditLogRoutes.js backend/src/routes/subscriptionRoutes.js backend/src/routes/reportRoutes.js backend/src/routes/messageRoutes.js backend/index.js
git commit -m "Rewrite remaining route guards to permission-based checks; fix ceo/staff_director report-route inconsistency"
```

---

### Task 8: signupController.js — seed new tenant's roles

**Files:**
- Modify: `backend/src/controllers/signupController.js`

**Interfaces:**
- Consumes: `PREBUILT_ROLE_NAMES` from Task 2.

- [ ] **Step 1: Add role-seeding to confirmSignup**

Immediately after the existing `company_settings` insert block (L148-154) and before the initial `ceo` practitioner insert (L155-159), add:

```js
const { rows: adminRoleRows } = await tenantPool.query(
  `INSERT INTO roles (name, is_system) VALUES ('Admin', true) RETURNING id`
);
const adminRoleId = adminRoleRows[0].id;
for (const roleName of PREBUILT_ROLE_NAMES) {
  const { rows } = await tenantPool.query('INSERT INTO roles (name) VALUES ($1) RETURNING id', [roleName]);
  await tenantPool.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [rows[0].id, 'staff_directory_view']);
}
```

Then update the existing ceo-insert query to also set `role_id`:

```js
await tenantPool.query(
  `INSERT INTO practitioners (first_name, last_name, email, password_hash, requires_password_change, role, role_id)
   VALUES ($1, $2, $3, $4, false, 'ceo', $5)`,
  [pending.ceo_first_name, pending.ceo_last_name, pending.ceo_email, pending.ceo_password_hash, adminRoleId]
);
```

Add the import at the top of the file:

```js
const { PREBUILT_ROLE_NAMES } = require('../constants/permissions');
```

Note: this is intentionally NOT redundant with the migration's `INSERT ... WHERE NOT EXISTS` seeding — a brand-new tenant's database is created fresh from `schema.sql` + the full `MIGRATIONS` list (which now includes `add_roles_permissions.sql`) during provisioning, so the migration's seed rows would already exist by the time this code runs, causing a duplicate-key error. Handle this by having the migration's seed logic run first (as part of schema setup) and this signup code simply skip re-seeding if rows already exist — reuse the same `WHERE NOT EXISTS` guards from the migration instead of a bare `INSERT`:

```js
const { rows: adminRoleRows } = await tenantPool.query(
  `INSERT INTO roles (name, is_system) SELECT 'Admin', true WHERE NOT EXISTS (SELECT 1 FROM roles WHERE is_system = true) RETURNING id`
);
let adminRoleId = adminRoleRows[0]?.id;
if (!adminRoleId) {
  const { rows } = await tenantPool.query('SELECT id FROM roles WHERE is_system = true');
  adminRoleId = rows[0].id;
}
for (const roleName of PREBUILT_ROLE_NAMES) {
  const { rows: existing } = await tenantPool.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  if (existing[0]) continue;
  const { rows } = await tenantPool.query('INSERT INTO roles (name) VALUES ($1) RETURNING id', [roleName]);
  await tenantPool.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [rows[0].id, 'staff_directory_view']);
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check backend/src/controllers/signupController.js`
Expected: no output.

- [ ] **Step 3: Manual verification**

Provision a brand-new throwaway test tenant end-to-end through the signup flow (same approach used to verify Phase 1), then:

```bash
NEW_TENANT_TOKEN="<jwt from logging in as that tenant's new ceo>"
curl -s http://localhost:8080/api/roles -H "Authorization: Bearer $NEW_TENANT_TOKEN"
```

Expected: 5 roles — Admin (`is_system: true`, empty `permissions`) plus the 4 prebuilt names, each with exactly `["staff_directory_view"]` — confirming new tenants get the true minimal default, distinct from Progressive's behavior-preserving backfill.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/signupController.js
git commit -m "Seed Admin + 4 prebuilt minimal-default roles for new tenant signups"
```

---

### Task 9: Frontend — fetch permissions, replace TAB_ACCESS

**Files:**
- Modify: `frontend/src/pages/AdminDashboard.jsx`

**Interfaces:**
- Consumes: `GET /api/auth/me` (Task 5) → `{ isAdmin: boolean, permissions: string[] }`.

- [ ] **Step 1: Replace the hardcoded TAB_ACCESS/ROLE_LABELS with a permission-key map**

Replace L15-38:

```js
const TAB_PERMISSION = {
  practitioners: 'staff_directory_view',
  reports:       'master_reports',
  billing:       'billing_pending',
  company:       null,  // requireOfficeStaff on the backend — visible to any non-practitioner
  subscription:  'subscription_billing',
  auditLog:      'audit_logs',
  roles:         'staff_directory_edit_role',
};

const TAB_TITLES = {
  practitioners: 'Staff Directory',
  reports:       'Master Reports',
  billing:       'Billing & Invoices',
  company:       'Company Information',
  subscription:  'Subscription & Billing',
  auditLog:      'Audit Log',
  roles:         'Roles & Permissions',
};
```

- [ ] **Step 2: Fetch permissions on mount and compute visibleTabs from them**

Replace the `localStorage.getItem('role')`-based lines (L42-48):

```js
const AdminDashboard = () => {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);

  useEffect(() => {
    api.get('/auth/me').then((res) => setMe(res.data)).catch(() => setMe({ isAdmin: false, permissions: [] }));
  }, []);

  const hasTabAccess = (tab) => {
    if (!me) return false;
    if (me.isAdmin) return true;
    const key = TAB_PERMISSION[tab];
    return key === null || me.permissions.includes(key);
  };

  const visibleTabs = me ? Object.keys(TAB_PERMISSION).filter(hasTabAccess) : [];

  const [activeTab, setActiveTab] = useState(null);
  useEffect(() => {
    if (me && activeTab === null) {
      setActiveTab(Object.keys(TAB_PERMISSION).find(hasTabAccess) || 'billing');
    }
  }, [me]);
```

(Use whatever the file's existing `api` import/axios-instance convention already is — follow the pattern used elsewhere in this same file for other API calls rather than introducing a new one.)

- [ ] **Step 3: Update the role-badge display**

Wherever `ROLE_LABELS[userRole]` was previously rendered (L316 per exploration), replace with a simple `me.isAdmin ? 'Admin' : '<role name>'` — since role names are now dynamic strings rather than a fixed lookup table, fetch the current user's role name from `/api/auth/me` too (extend the `getMe` response in Task 5 to include `roleName`, or accept showing just "Admin"/"Staff" if the exact custom name isn't otherwise available on this screen — the simplest option is adding `roleName` to `getMe`'s response, so do that: update `authController.js`'s `getMe` from Task 5 to `SELECT r.name FROM roles r JOIN practitioners p ON p.role_id = r.id WHERE p.id = $1` for non-ceo/practitioner accounts, falling back to `'Admin'`/`'Practitioner'` literals for those two fixed cases).

- [ ] **Step 4: Verify syntax**

Run: `node --check frontend/src/pages/AdminDashboard.jsx` (Node can syntax-check JSX-free logic; if this file has JSX that plain `node --check` rejects, instead run the project's existing build/lint command, e.g. `npm run build` from `frontend/`, and confirm no new errors are introduced by this file).

- [ ] **Step 5: Manual verification in a browser**

Start the frontend dev server, log in as the migrated Billing Specialist account, and confirm only the Billing & Invoices tab (plus Company Information, since that's `requireOfficeStaff`-only) is visible — no Staff Directory, Reports, Subscription, Audit Log, or Roles tab. Then log in as Admin/ceo and confirm all 7 tabs are visible including the new Roles & Permissions tab.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/AdminDashboard.jsx backend/src/controllers/authController.js
git commit -m "Replace hardcoded TAB_ACCESS with permission-driven tab visibility"
```

---

### Task 10: Frontend — Role Management tab UI

**Files:**
- Create: `frontend/src/pages/RoleManagement.jsx`
- Modify: `frontend/src/pages/AdminDashboard.jsx` (render the new tab's content when active)

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/roles` (Task 4).

- [ ] **Step 1: Write RoleManagement.jsx**

Follow the existing tab-content component pattern already used for the other tabs in this app (look at how `SubscriptionBilling.jsx` is structured and imported into `AdminDashboard.jsx`, and mirror that shape exactly — same loading/error state conventions, same `Loader2` spinner-on-async-button pattern, same card/list styling). Structure:

```jsx
import { useState, useEffect } from 'react';
import { Loader2, Trash2, Plus } from 'lucide-react';
import api from '../api'; // match whatever this project's existing api-client import path actually is

const PERMISSION_GROUPS = [
  { label: 'Staff Directory', keys: ['staff_directory_view', 'staff_directory_edit', 'staff_directory_edit_role', 'register_new_user'] },
  { label: 'Billing & Invoices', keys: ['billing_pending', 'billing_completed', 'billing_invoice_status'] },
  { label: 'Reports & Compliance', keys: ['master_reports', 'action_required_approve', 'audit_logs'] },
  { label: 'Company Information', keys: ['company_info_compliance_doc', 'company_info_dropdown_options'] },
  { label: 'Subscription', keys: ['subscription_billing'] },
];

const PERMISSION_LABELS = {
  staff_directory_view: 'View staff directory',
  staff_directory_edit: 'Edit staff profiles',
  staff_directory_edit_role: 'Manage roles & staff access',
  register_new_user: 'Register new users',
  billing_pending: 'Pending bills',
  billing_completed: 'Completed bills',
  billing_invoice_status: 'Invoice status',
  master_reports: 'Master reports',
  action_required_approve: 'Approve flagged logs',
  audit_logs: 'Audit log',
  company_info_compliance_doc: 'Compliance reference document',
  company_info_dropdown_options: 'Dropdown options',
  subscription_billing: 'Subscription & billing',
};

const RoleManagement = () => {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const loadRoles = () => api.get('/roles').then((res) => setRoles(res.data)).finally(() => setLoading(false));
  useEffect(() => { loadRoles(); }, []);

  const togglePermission = async (role, key) => {
    if (role.is_system) return;
    setSavingId(role.id);
    const nextPermissions = role.permissions.includes(key)
      ? role.permissions.filter((k) => k !== key)
      : [...role.permissions, key];
    await api.patch(`/roles/${role.id}`, { permissions: nextPermissions });
    await loadRoles();
    setSavingId(null);
  };

  const createRole = async () => {
    const name = window.prompt('New role name:');
    if (!name) return;
    await api.post('/roles', { name, permissions: ['staff_directory_view'] });
    await loadRoles();
  };

  const deleteRole = async (role) => {
    if (role.is_system) return;
    if (!window.confirm(`Delete the "${role.name}" role? Staff currently holding it must be reassigned first.`)) return;
    await api.delete(`/roles/${role.id}`);
    await loadRoles();
  };

  if (loading) return <Loader2 className="animate-spin" />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Roles & Permissions</h2>
        <button onClick={createRole} className="flex items-center gap-1 text-teal-700 cursor-pointer">
          <Plus size={16} /> New Role
        </button>
      </div>
      {roles.map((role) => (
        <div key={role.id} className="border border-slate-200 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <span className="font-medium">{role.name}{role.is_system && ' (fixed — full access)'}</span>
            {!role.is_system && (
              <button onClick={() => deleteRole(role)} aria-label={`Delete ${role.name}`} className="text-red-600 cursor-pointer">
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {!role.is_system && PERMISSION_GROUPS.map((group) => (
            <div key={group.label} className="mb-2">
              <div className="text-xs uppercase text-slate-500 mb-1">{group.label}</div>
              {group.keys.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={role.permissions.includes(key)}
                    disabled={savingId === role.id}
                    onChange={() => togglePermission(role, key)}
                  />
                  {PERMISSION_LABELS[key]}
                </label>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default RoleManagement;
```

(Match the project's actual existing `api` client import and Tailwind class conventions precisely — this sketch follows the teal/slate palette already established in `SubscriptionBilling.jsx` per the Phase 1 UI notes, but the implementer should copy the exact button/card classes from that file rather than retyping approximations.)

- [ ] **Step 2: Render it from AdminDashboard.jsx**

Add the import and render branch alongside the other tab-content conditionals (following whatever pattern the file already uses — likely a `{activeTab === 'billing' && <BillingSection />}`-style block):

```jsx
import RoleManagement from './RoleManagement';
// ...
{activeTab === 'roles' && <RoleManagement />}
```

- [ ] **Step 3: Manual verification in a browser**

Log in as Admin, open the new Roles & Permissions tab, toggle a permission on a non-Admin role, then log in as a staff member holding that role (in a second browser session/incognito window) and confirm the change is visible immediately — reload their page, no re-login required — matching the spec's "immediate effect" requirement end-to-end.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/RoleManagement.jsx frontend/src/pages/AdminDashboard.jsx
git commit -m "Add Role Management tab UI"
```

---

### Task 11: Frontend — RegisterPractitionerForm.jsx role dropdown from API

**Files:**
- Modify: `frontend/src/components/RegisterPractitionerForm.jsx`

**Interfaces:**
- Consumes: `GET /api/roles` (Task 4).

- [ ] **Step 1: Replace the hardcoded role list with a fetched one**

Fetch `GET /api/roles` on mount, populate the role `<select>` from the returned list (`role.id` as the value, `role.name` as the label) instead of the previous hardcoded 5-string list. Submit `roleId` (the selected role's `id`) instead of a `role` string — this requires `provisionPractitioner` (Task 5) to also accept and use `roleId` when creating a new office-staff account; check the current `provisionPractitioner` body-parsing logic and extend it to set `role_id = roleId` on insert (alongside the existing `role` literal, which becomes `'staff'` for any non-Admin roleId, `'ceo'` if the selected role's `is_system` is true) the same way `updateStaffRole` was rewritten in Task 5.

- [ ] **Step 2: Remove the client-side position-title-based role auto-remap**

The existing L667 logic (`positionTitle === 'Office Staff' && regForm.role === 'practitioner' ? 'staff_director' : regForm.role`) silently substituted `'staff_director'` for a hardcoded position title — this no longer makes sense once role assignment is an explicit dropdown selection rather than an implied one, and `'staff_director'` isn't a valid role value anymore. Delete this remapping entirely; the user's explicit dropdown selection is now the sole source of truth for which role gets assigned.

- [ ] **Step 3: Verify syntax**

Run the project's frontend build/lint command (e.g. `npm run build` from `frontend/`) and confirm no new errors from this file.

- [ ] **Step 4: Manual verification in a browser**

Log in as Admin, open the register-practitioner form, confirm the role dropdown now lists Admin + the 4 prebuilt roles (or any custom roles created in Task 10's testing) instead of the old 5 hardcoded strings, and confirm submitting successfully creates an invite-pending account with the selected role.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RegisterPractitionerForm.jsx backend/src/controllers/authController.js
git commit -m "Populate role dropdown from /api/roles instead of hardcoded role strings"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section (data model, enforcement, role management API/UI, migration/backfill, "Progressive keeps full future access") maps to at least one task above (Tasks 1–2 → data model, Task 3 → enforcement, Task 4/10 → role management API/UI, Task 1/8 → migration, Task 4's unrestricted CRUD + Task 10 → Progressive's ongoing access is just the normal API with no special-casing).
- **Placeholder scan:** no TBD/TODO left; the one soft spot (Task 9 Step 3's role-badge display, Task 11's exact api-client import path) is flagged explicitly as "match the existing pattern in this file" rather than left unspecified, since guessing the project's exact axios-wrapper name without reading the file first would risk inventing a wrong import — the assigned engineer reads the target file's existing imports before writing this line, same as any other task that says "follow the existing pattern."
- **Type/signature consistency check:** `requirePermission(key)` (Task 3) is called identically in Tasks 4–7; `req.permissions`/`req.isAdmin` (Task 3) are read identically in Task 5's `provisionPractitioner`/`updateStaffProfile` rewrites and Task 9's frontend logic (via the `getMe` JSON shape, which matches what Task 3 sets); `PERMISSION_KEYS` (Task 2) is validated against identically in Task 4's `roleController.js`.
