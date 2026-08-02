# Custom Dropdown Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company create its own additional dropdown categories (beyond the 4 fixed, state-mandated ones), have them appear as extra optional/required fields when a practitioner logs a session, and optionally use them as a match/mismatch comparison factor in Compliance Analysis.

**Architecture:** A new `dropdown_categories` registry table replaces the hardcoded 4-value allowlist that currently gates `dropdown_options.category` in three separate places (a DB CHECK constraint, a backend cache filter, and a controller validation check) — all three become dynamic, driven by this table instead of a fixed array. The log-entry form (web + mobile) renders one additional field per active custom category and stores chosen values in `assessments.form_data` (an existing, currently-unused JSONB column). Compliance Analysis's existing "map an extra Excel column to one of our comparable fields" mechanism is extended to also accept a custom category as a comparison target, reusing its existing label-matching approach.

**Tech Stack:** Node.js/Express, PostgreSQL (`pg`), React/Vite (web), React Native (mobile) — no automated test framework in this repo (confirmed absent), so verification here follows the same pattern as the Phase 2 plan: `node --check` for backend syntax, `eslint`/`npm run build` for frontend, and manual scratch-database verification for anything schema-related, since Phase 2's migration bug was only caught because a later deploy attempt ran the real thing against a real database.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-01-custom-dropdown-categories-design.md` — every task below implements one section of it.
- The 4 built-in categories (`service_type`, `service_status`, `location`, `group_size`) must be completely unaffected in behavior — same tab order, same code/name management, same log-form rendering, same NJEIS billing-code generation.
- Built-in categories can never be renamed or deleted via the API; custom categories can be, except while still referenced by a `compareTo` mapping or (implicitly, since categories can't be un-created once options exist and are in use) don't add extra restrictions beyond what's specified.
- No new permission key — category management stays gated on the existing `company_info_dropdown_options` permission; the Excel `compareTo` mapping screen stays gated on `company_info_compliance_doc`.
- Any new migration file must be appended to `backend/db/migrations/index.js`'s `MIGRATIONS` array (currently ends with `'add_roles_permissions.sql'`) — this same list drives both existing-tenant migration and brand-new-tenant provisioning.
- This codebase has 3 separate hardcoded places currently gating dropdown categories to the fixed 4 (`dropdownOptionsCache.js`'s `CATEGORIES` array, `dropdownOptionsController.js`'s allowlist check, and the DB CHECK constraint) plus 3 separate hardcoded places gating Compliance Analysis's `compareTo` targets (`companyController.js`'s `VALID_CUSTOM_FIELD_COMPARE_TO`, `CompanySettings.jsx`'s `<option>` list, `billingController.js`'s `if` branches) — every one of these must move in lockstep or a category will silently work in some places and not others.

---

## File Structure

New files:
- `backend/db/migrations/add_dropdown_categories.sql` — schema migration
- `backend/src/controllers/dropdownCategoriesController.js` — CRUD for categories

Modified files:
- `backend/db/migrations/index.js` — register new migration
- `backend/db/schema.sql` — new-tenant schema gains the new table (see Task 1)
- `backend/src/constants/dropdownOptionsCache.js` — dynamic (not fixed-array) cache loading
- `backend/src/controllers/dropdownOptionsController.js` — category validation now dynamic
- `backend/src/routes/dropdownOptionsRoutes.js` — mount new category routes
- `frontend/src/hooks/useDropdownOptions.js` — expose category metadata alongside options
- `frontend/src/components/DropdownOptionsManager.jsx` — tabbed UI + "+" to add categories
- `backend/index.js` — `POST /api/interventions` stores custom field values
- `frontend/src/components/LogInterventionModal.jsx` — renders custom category fields
- `mobile/src/pages/LogIntervention.tsx` + `mobile/src/contexts/AppDataContext.tsx` — same, for mobile
- `backend/src/constants/njeis.js` — new generic `mapCategoryLabelToCode` for custom categories
- `backend/src/controllers/companyController.js` — `compareTo` validation accepts custom categories
- `frontend/src/components/CompanySettings.jsx` — `compareTo` picker lists custom categories
- `backend/src/controllers/billingController.js` — new comparison branch for custom categories

---

### Task 1: Migration — dropdown_categories table, widen dropdown_options

**Files:**
- Create: `backend/db/migrations/add_dropdown_categories.sql`
- Modify: `backend/db/migrations/index.js`
- Modify: `backend/db/schema.sql` (add the new table so brand-new tenants get it from schema.sql directly, matching this repo's existing pattern of new tables living in both schema.sql AND being idempotently created by their own migration for existing tenants — see how `company_settings.compliance_doc_custom_fields` etc. already live in schema.sql)

**Interfaces:**
- Produces: `dropdown_categories` table (`id uuid`, `key text UNIQUE`, `display_name text`, `is_custom boolean`, `is_required_on_log boolean`, `sort_order integer`, `is_active boolean`, `created_at`, `updated_at`). `dropdown_options.category` becomes a plain `text` FK-like reference to `dropdown_categories.key` (no DB-level FK constraint needed since `category` already has its own values keyed by string — a `REFERENCES` FK is added for real integrity). These are what every later task's queries reference.

- [ ] **Step 1: Write the migration SQL**

```sql
-- backend/db/migrations/add_dropdown_categories.sql
--
-- Replaces the 4-value hardcoded allowlist gating dropdown_options.category
-- with a real registry table, so a company can define its own additional
-- dropdown categories beyond the 4 built-in, state-mandated ones.
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_dropdown_categories.sql

CREATE TABLE IF NOT EXISTS dropdown_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  display_name text NOT NULL,
  is_custom boolean NOT NULL DEFAULT true,
  is_required_on_log boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dropdown_categories_key_key UNIQUE (key)
);

-- Seed the 4 built-ins, matching their current fixed tab order exactly.
INSERT INTO dropdown_categories (key, display_name, is_custom, sort_order)
  SELECT v.key, v.display_name, false, v.sort_order
  FROM (VALUES
    ('service_type', 'Service Type', 0),
    ('service_status', 'Service Status', 1),
    ('location', 'Location', 2),
    ('group_size', 'Group Size Category', 3)
  ) AS v(key, display_name, sort_order)
  WHERE NOT EXISTS (SELECT 1 FROM dropdown_categories WHERE dropdown_categories.key = v.key);

-- Drop the old hardcoded CHECK — a category is now valid if it exists as a
-- row in dropdown_categories, not if it matches one of 4 literal strings.
ALTER TABLE dropdown_options DROP CONSTRAINT IF EXISTS dropdown_options_category_check;

-- Real referential integrity: every dropdown_options row's category must
-- point at a real dropdown_categories.key. Added AFTER the seed insert
-- above so the 4 built-ins already exist and this doesn't reject any
-- existing dropdown_options row.
ALTER TABLE dropdown_options DROP CONSTRAINT IF EXISTS dropdown_options_category_fkey;
ALTER TABLE dropdown_options ADD CONSTRAINT dropdown_options_category_fkey
  FOREIGN KEY (category) REFERENCES dropdown_categories(key);
```

- [ ] **Step 2: Register the migration**

Edit `backend/db/migrations/index.js`:

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
  'add_dropdown_categories.sql',
];

module.exports = { MIGRATIONS };
```

- [ ] **Step 3: Add the table to schema.sql for brand-new tenants**

Read `backend/db/schema.sql` in full first to find where `dropdown_options`'s `CREATE TABLE` currently lives (added by a prior migration being folded into schema.sql, or check if `dropdown_options` is even in schema.sql at all — if it's NOT there yet and only exists via the `add_dropdown_options.sql` migration, then `dropdown_categories` should be added the same way: migration-only, NOT touching schema.sql, since a brand-new tenant's `confirmSignup` provisioning applies `schema.sql` THEN every migration in `MIGRATIONS` in order — so the migration alone is sufficient for new tenants too, exactly like `add_roles_permissions.sql` didn't need a schema.sql change either). Confirm this by checking whether `dropdown_options`'s own CREATE TABLE appears in schema.sql; if it does NOT, skip this step entirely (the migration alone already covers both existing and brand-new tenants) and note that in your report.

- [ ] **Step 4: Syntax-check the SQL against a scratch database**

No local Postgres/dev server is available in this environment by default — if you have Cloud SQL Auth Proxy access already configured (check for a running proxy or ask), apply this against a throwaway scratch database (never `tenant_progressive` or any real tenant), matching the exact verification approach used for the Phase 2 migration:

```bash
psql <scratch-db-connection> -f backend/db/schema.sql
psql <scratch-db-connection> -c "INSERT INTO dropdown_options (category, code, label) VALUES ('service_type', 'ZZ', 'Test Existing Row')"
psql <scratch-db-connection> -f backend/db/migrations/add_dropdown_categories.sql
psql <scratch-db-connection> -c "SELECT key, display_name, is_custom FROM dropdown_categories ORDER BY sort_order"
psql <scratch-db-connection> -c "INSERT INTO dropdown_options (category, code, label) VALUES ('nonexistent_category', 'X', 'Should fail')"
```

Expected: the 4 built-ins list correctly with `is_custom = false`; the last INSERT fails with a foreign-key violation (confirming the new FK actually enforces something). If no Postgres access is available at all in this environment, do a careful manual statement-by-statement trace instead (confirm the `WHERE NOT EXISTS` guards are correct, confirm the FK is added only after the seed insert, confirm `DROP CONSTRAINT IF EXISTS` names match this database's actual current constraint name — grep `backend/db/schema.sql` for `dropdown_options` to find its real constraint name if any exists) and report this substitution explicitly as DONE_WITH_CONCERNS.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/add_dropdown_categories.sql backend/db/migrations/index.js backend/db/schema.sql
git commit -m "Add dropdown_categories registry table"
```

---

### Task 2: Backend — dynamic cache loading

**Files:**
- Modify: `backend/src/constants/dropdownOptionsCache.js`

**Interfaces:**
- Consumes: `dropdown_categories` table from Task 1.
- Produces: `getDropdownOptionsCache(tenantDbName)` — same name/signature as today, but now returns an object keyed by EVERY active category's `key` (built-in + custom), not just the 4 fixed ones. Also produces a new `getDropdownCategoriesCache(tenantDbName)` returning the full category metadata (`key`, `display_name`, `is_custom`, `is_required_on_log`, `sort_order`) — used by Task 3's controller and Task 5's frontend tab UI.

- [ ] **Step 1: Read the current file in full**

Read `backend/src/constants/dropdownOptionsCache.js` completely before editing — you need its exact current per-tenant `Map` structure (`cacheByTenant`), the `CATEGORIES`/`EMPTY_CACHE` constants, and `loadDropdownOptionsCache`/`ensureDropdownOptionsCacheLoaded`/`getDropdownOptionsCache` function bodies to edit them correctly rather than guessing at their current shape.

- [ ] **Step 2: Replace the fixed CATEGORIES-based grouping with dynamic grouping**

Remove the hardcoded `CATEGORIES` array and `EMPTY_CACHE` object (both currently list exactly the 4 fixed keys). Replace the options-loading query to also fetch category metadata, and build the cache dynamically from whatever categories actually exist:

```js
// Both caches are now dynamic — keyed by whatever categories exist in this
// tenant's dropdown_categories table (built-in + custom), not a fixed list.
// A category with zero options yet still gets an empty array key so
// consumers don't need an `|| []` guard for a brand-new custom category.
async function loadDropdownOptionsCache(tenantDbName) {
  const pool = getTenantPool(tenantDbName);
  const { rows: categoryRows } = await pool.query(
    'SELECT key, display_name, is_custom, is_required_on_log, sort_order FROM dropdown_categories WHERE is_active = true ORDER BY sort_order, key'
  );
  const { rows: optionRows } = await pool.query(
    'SELECT id, category, code, label, sort_order, is_active FROM dropdown_options ORDER BY category, sort_order, id'
  );

  const optionsByCategory = {};
  for (const cat of categoryRows) optionsByCategory[cat.key] = [];
  for (const row of optionRows) {
    if (!optionsByCategory[row.category]) optionsByCategory[row.category] = [];
    optionsByCategory[row.category].push(row);
  }

  categoriesByTenant.set(tenantDbName, categoryRows);
  cacheByTenant.set(tenantDbName, optionsByCategory);
}
```

(Match this to the file's ACTUAL existing variable names for the tenant pool getter and the `Map` instances — the snippet above uses illustrative names; read the file first per Step 1 and use its real names. Add a new `categoriesByTenant` `Map` alongside the existing `cacheByTenant` one.)

- [ ] **Step 3: Add getDropdownCategoriesCache and update the empty-tenant fallback**

```js
function getDropdownCategoriesCache(tenantDbName) {
  return categoriesByTenant.get(tenantDbName) || [];
}
```

Update `getDropdownOptionsCache(tenantDbName)`'s not-yet-warmed fallback from the old `EMPTY_CACHE` (now removed) to a plain `{}` — every consumer that reads `cache[category]` must handle `undefined` gracefully already (e.g. `njeis.js`'s `activeOptions` does `getDropdownOptionsCache()[category].filter(...)` with NO guard — this will need hardening in a later task if it's ever called for a category that doesn't exist yet, but for the 4 built-ins and any already-created custom category this is a non-issue since they're always present once the cache is warm).

- [ ] **Step 4: Update the module exports**

Add `getDropdownCategoriesCache` to the file's `module.exports` alongside the existing exports.

- [ ] **Step 5: Verify syntax**

Run: `node --check backend/src/constants/dropdownOptionsCache.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/constants/dropdownOptionsCache.js
git commit -m "Make dropdown options cache dynamic instead of a fixed 4-category list"
```

---

### Task 3: Backend — category CRUD (controller + routes)

**Files:**
- Create: `backend/src/controllers/dropdownCategoriesController.js`
- Modify: `backend/src/controllers/dropdownOptionsController.js` (category validation)
- Modify: `backend/src/routes/dropdownOptionsRoutes.js` (mount new routes)

**Interfaces:**
- Consumes: `getDropdownCategoriesCache`, `loadDropdownOptionsCache` from Task 2; `pool` from `backend/src/config/db.js`.
- Produces: `GET/POST/PATCH/DELETE /api/dropdown-options/categories` — consumed by Task 5's frontend tab UI.

- [ ] **Step 1: Read dropdownOptionsController.js in full**

You need its exact current `createDropdownOption` function (the one with the hardcoded `CATEGORIES.includes(category)` check) to edit it correctly.

- [ ] **Step 2: Write dropdownCategoriesController.js**

```js
// backend/src/controllers/dropdownCategoriesController.js
const { pool } = require('../config/db');
const { loadDropdownOptionsCache, getCurrentTenantDbForCache } = require('../constants/dropdownOptionsCache');
// ^ adjust this import to match whatever the actual current tenant-db-name
// resolution mechanism is in dropdownOptionsController.js's existing write
// functions (they already call loadDropdownOptionsCache(...) after a
// mutation per the plan's Global Constraints — read that file's exact
// pattern in Step 1 and mirror it here precisely, including whatever
// argument loadDropdownOptionsCache expects).

async function listDropdownCategories(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, key, display_name, is_custom, is_required_on_log, sort_order, is_active FROM dropdown_categories ORDER BY sort_order, key'
    );
    res.json({ categories: rows });
  } catch (err) {
    console.error('List dropdown categories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function createDropdownCategory(req, res) {
  const { displayName, isRequiredOnLog } = req.body;
  if (!displayName || !displayName.trim()) {
    return res.status(400).json({ error: 'A category name is required.' });
  }
  const key = slugify(displayName);
  if (!key) {
    return res.status(400).json({ error: 'That name could not be turned into a valid category key — try including at least one letter or number.' });
  }
  try {
    const { rows: existing } = await pool.query('SELECT id FROM dropdown_categories WHERE key = $1', [key]);
    if (existing[0]) {
      return res.status(409).json({ error: 'A category with that name already exists.' });
    }
    const { rows: maxSort } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM dropdown_categories');
    const { rows } = await pool.query(
      `INSERT INTO dropdown_categories (key, display_name, is_custom, is_required_on_log, sort_order)
       VALUES ($1, $2, true, $3, $4)
       RETURNING id, key, display_name, is_custom, is_required_on_log, sort_order, is_active`,
      [key, displayName.trim(), Boolean(isRequiredOnLog), maxSort[0].next]
    );
    // Refresh the cache the same way every dropdown-option write already does,
    // so this new category is immediately usable for the log form/matching.
    // (Match this call to dropdownOptionsController.js's exact existing pattern.)
    // await loadDropdownOptionsCache(tenantDbName);
    res.status(201).json({ category: rows[0] });
  } catch (err) {
    console.error('Create dropdown category error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateDropdownCategory(req, res) {
  const { id } = req.params;
  const { displayName, isRequiredOnLog } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT is_custom FROM dropdown_categories WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Category not found.' });
    if (!existing[0].is_custom) return res.status(400).json({ error: 'This is a built-in category and cannot be edited.' });

    const sets = [];
    const values = [];
    if (displayName !== undefined) { values.push(displayName.trim()); sets.push(`display_name = $${values.length}`); }
    if (isRequiredOnLog !== undefined) { values.push(Boolean(isRequiredOnLog)); sets.push(`is_required_on_log = $${values.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE dropdown_categories SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}
       RETURNING id, key, display_name, is_custom, is_required_on_log, sort_order, is_active`,
      values
    );
    res.json({ category: rows[0] });
  } catch (err) {
    console.error('Update dropdown category error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteDropdownCategory(req, res) {
  const { id } = req.params;
  try {
    const { rows: existing } = await pool.query('SELECT key, is_custom FROM dropdown_categories WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Category not found.' });
    if (!existing[0].is_custom) return res.status(400).json({ error: 'This is a built-in category and cannot be deleted.' });

    const { rows: settingsRows } = await pool.query('SELECT compliance_doc_custom_fields FROM company_settings WHERE id = 1');
    const customFields = settingsRows[0]?.compliance_doc_custom_fields || [];
    const stillMapped = customFields.some((cf) => cf.compareTo === `custom_category:${existing[0].key}`);
    if (stillMapped) {
      return res.status(409).json({ error: 'This category is still mapped as a comparison field in State Compliance Reference — remove that mapping first.' });
    }

    await pool.query('DELETE FROM dropdown_categories WHERE id = $1', [id]);
    // Deleting the category row cascades to its dropdown_options rows via
    // the FK's ON DELETE behavior if one is set, or leaves them orphaned if
    // not — confirm Task 1's migration's FK direction: dropdown_options.category
    // REFERENCES dropdown_categories.key with no explicit ON DELETE clause
    // defaults to NO ACTION/RESTRICT, so this DELETE will fail with a FK
    // violation if any dropdown_options rows still reference this category.
    // That's actually the SAFER default (can't silently orphan/cascade-delete
    // real option rows) — if it fails, surface a clear error instead of the
    // raw Postgres one:
    res.status(204).send();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'This category still has options defined — remove them first.' });
    }
    console.error('Delete dropdown category error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listDropdownCategories, createDropdownCategory, updateDropdownCategory, deleteDropdownCategory };
```

- [ ] **Step 3: Wire the cache-refresh call correctly**

The commented-out `await loadDropdownOptionsCache(tenantDbName)` line in `createDropdownCategory` above is a placeholder for you to fill in exactly — read how `dropdownOptionsController.js`'s existing write functions (e.g. `createDropdownOption`) call this today (what tenant-db-name argument they pass, e.g. `getCurrentTenantDb()` from `../config/tenantContext` or similar) and use the IDENTICAL call in `createDropdownCategory`, `updateDropdownCategory`, and `deleteDropdownCategory` (after their respective mutations) so a newly created/renamed/deleted category is immediately reflected, matching this codebase's established "every write refreshes the cache synchronously" pattern.

- [ ] **Step 4: Update dropdownOptionsController.js's category validation**

Replace the hardcoded `if (!CATEGORIES.includes(category))` check in `createDropdownOption` with a dynamic check against the real category registry:

```js
const { rows: categoryRows } = await pool.query('SELECT 1 FROM dropdown_categories WHERE key = $1 AND is_active = true', [category]);
if (!categoryRows[0]) {
  return res.status(400).json({ error: 'Invalid category' });
}
```

Remove the now-unused `CATEGORIES` import from `dropdownOptionsCache.js` if this file doesn't reference it anywhere else (check with a grep of the file before removing).

- [ ] **Step 5: Mount the new routes**

Edit `backend/src/routes/dropdownOptionsRoutes.js`: add the new controller's import and 4 new routes, following the exact same `protect, loadPermissions, requirePermission('company_info_dropdown_options')`-guarded pattern the existing write routes already use, with `GET` left on `protect`-only (matching the existing `GET /api/dropdown-options` route's reasoning — any authenticated role needs the category list to render the log form):

```js
const {
  listDropdownCategories,
  createDropdownCategory,
  updateDropdownCategory,
  deleteDropdownCategory,
} = require('../controllers/dropdownCategoriesController');

router.get('/categories', protect, listDropdownCategories);
router.post('/categories', writeGuard, createDropdownCategory);
router.patch('/categories/:id', writeGuard, updateDropdownCategory);
router.delete('/categories/:id', writeGuard, deleteDropdownCategory);
```

(Read the file first to confirm the exact existing `writeGuard` variable name/array shape and reuse it verbatim rather than reconstructing it — this file already defines one for the existing 4 write routes.)

- [ ] **Step 6: Verify syntax**

Run: `node --check backend/src/controllers/dropdownCategoriesController.js && node --check backend/src/controllers/dropdownOptionsController.js && node --check backend/src/routes/dropdownOptionsRoutes.js`
Expected: no output.

- [ ] **Step 7: Manual verification**

No live DB in this environment by default — if you have scratch-DB access from Task 1, verify end-to-end:

```bash
TOKEN="<jwt for an Admin/ceo account on the scratch tenant>"
curl -s -X POST http://localhost:8080/api/dropdown-options/categories -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"displayName":"Insurance Type","isRequiredOnLog":true}'
curl -s http://localhost:8080/api/dropdown-options/categories -H "Authorization: Bearer $TOKEN"
```

Expected: 201 with `key: "insurance_type"`, then the GET lists all 5 categories (4 built-in + this one). Then confirm a built-in can't be edited/deleted:

```bash
SERVICE_TYPE_ID=$(curl -s http://localhost:8080/api/dropdown-options/categories -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).categories.find(c=>c.key==='service_type').id))")
curl -s -X DELETE http://localhost:8080/api/dropdown-options/categories/$SERVICE_TYPE_ID -H "Authorization: Bearer $TOKEN"
```

Expected: `400 { "error": "This is a built-in category and cannot be deleted." }`. If no DB access is available, do a careful manual code trace instead and report as DONE_WITH_CONCERNS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/dropdownCategoriesController.js backend/src/controllers/dropdownOptionsController.js backend/src/routes/dropdownOptionsRoutes.js
git commit -m "Add dropdown category CRUD API"
```

---

### Task 4: Frontend — useDropdownOptions hook exposes category metadata

**Files:**
- Modify: `frontend/src/hooks/useDropdownOptions.js`

**Interfaces:**
- Consumes: `GET /api/dropdown-options/categories` (Task 3).
- Produces: `useDropdownOptions()` now also returns `categories` (array of `{ id, key, display_name, is_custom, is_required_on_log, sort_order, is_active }`, sorted) alongside its existing `options`/`isLoading`/`refetch` — consumed by Task 5 (tab UI) and Task 6/7 (log-form custom fields).

- [ ] **Step 1: Read the current file in full**

- [ ] **Step 2: Add a second fetch for categories, run in parallel with the existing options fetch**

```js
const [categories, setCategories] = useState([]);
// ... inside the existing fetch effect/function, alongside the options fetch:
const [optionsRes, categoriesRes] = await Promise.all([
  api.get('/api/dropdown-options'),
  api.get('/api/dropdown-options/categories'),
]);
setOptions(optionsRes.data.options);
setCategories(categoriesRes.data.categories);
```

(Adapt to the file's actual existing fetch structure — read it first per Step 1. If the existing fetch is a single `api.get('/api/dropdown-options').then(...)` chain rather than `async/await`, keep the same style rather than introducing a different one.)

- [ ] **Step 3: Return categories from the hook**

Update the hook's return statement to include `categories` alongside the existing `options`, `isLoading`, `refetch`.

- [ ] **Step 4: Verify**

Run the project's frontend build/lint command (check `frontend/package.json`) and confirm no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDropdownOptions.js
git commit -m "Expose category metadata from useDropdownOptions"
```

---

### Task 5: Frontend — tabbed Dropdown Options UI + "+" to add categories

**Files:**
- Modify: `frontend/src/components/DropdownOptionsManager.jsx`

**Interfaces:**
- Consumes: `categories` from Task 4's `useDropdownOptions()`; `POST/PATCH/DELETE /api/dropdown-options/categories` from Task 3.

- [ ] **Step 1: Read the current file in full**

This file currently renders ALL 4 categories' option-tables stacked vertically (via `SECTIONS.map(...)`), not tabbed. You are converting this to a tabbed layout.

- [ ] **Step 2: Replace the hardcoded SECTIONS array with categories from the hook**

Remove the hardcoded `SECTIONS` constant. Add `const { options, categories, isLoading, refetch } = useDropdownOptions();` (extending the existing `useDropdownOptions()` call to also destructure `categories`). Add local state for the active tab: `const [activeCategory, setActiveCategory] = useState(null);` defaulting to the first category once `categories` loads (mirror whatever pattern `AdminDashboard.jsx` already uses for its own tab-defaulting, e.g. a `useEffect` that sets it once on first load).

- [ ] **Step 3: Render a tab bar**

```jsx
<div className="flex items-center gap-1 border-b border-slate-200 mb-4">
  {categories.map((cat) => (
    <button
      key={cat.key}
      onClick={() => setActiveCategory(cat.key)}
      className={`px-4 py-2 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition-colors ${
        activeCategory === cat.key ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {cat.display_name}
    </button>
  ))}
  <button
    onClick={() => setIsAddingCategory(true)}
    aria-label="Add a new dropdown category"
    className="px-3 py-2 text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer"
  >
    +
  </button>
</div>
```

Below the tab bar, render only the ONE `OptionSection` matching `activeCategory` (reusing the existing `OptionSection` component completely unchanged — it's already parameterized by `category`/`title`/`hint`/`rows`).

- [ ] **Step 4: Add the "+" inline create-category form**

Add `const [isAddingCategory, setIsAddingCategory] = useState(false);` and a small form (name input + "Required when logging a session" checkbox + Save/Cancel), following this file's existing `NewOptionRow` component as your visual/interaction template (inline row, `onBlur`/explicit-Save pattern, error message shown inline). On save, `POST /api/dropdown-options/categories`, then `refetch()` (the hook's existing refetch, which now also needs to re-fetch categories — confirm Task 4's `refetch` does this) and switch `activeCategory` to the newly created category's key.

- [ ] **Step 5: Add a "Delete category" action for custom (non-built-in) tabs**

Only shown when `categories.find(c => c.key === activeCategory)?.is_custom` is true. Use `showConfirm` (already imported in this file) before calling `DELETE /api/dropdown-options/categories/:id`, matching this file's existing `handleDelete` pattern in `OptionRow`. On success, switch `activeCategory` back to the first remaining category and `refetch()`.

- [ ] **Step 6: Verify**

Run the project's frontend build/lint command and confirm no new errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/DropdownOptionsManager.jsx
git commit -m "Add tabbed dropdown category UI with + to create custom categories"
```

---

### Task 6: Backend — POST /api/interventions stores custom field values

**Files:**
- Modify: `backend/index.js` (the `POST /api/interventions` handler)

**Interfaces:**
- Consumes: nothing new from earlier tasks structurally — just needs `req.body.custom_fields` (an object like `{ "<category_key>": "<code>" }`, sent by Task 7/8).
- Produces: `assessments.form_data` now stores `{ custom_fields: {...} }` instead of always `{}` — consumed by Task 12's compliance-analysis comparison branch.

- [ ] **Step 1: Read the full current handler**

Confirm its exact current destructure and the final bind-params array (currently ending in `JSON.stringify({})`).

- [ ] **Step 2: Add custom_fields to the destructure and the insert**

```js
const {
  // ... all existing destructured fields, unchanged ...
  custom_fields,
} = req.body;
```

Replace the final `JSON.stringify({})` in the INSERT's values array with:

```js
JSON.stringify({ custom_fields: (custom_fields && typeof custom_fields === 'object') ? custom_fields : {} })
```

(No other part of this handler changes — the ownership check, service-type-registration check, and INSERT's column list/placeholders all stay exactly as they are today, since `form_data`'s position in that list is unchanged.)

- [ ] **Step 3: Verify syntax**

Run: `node --check backend/index.js`
Expected: no output.

- [ ] **Step 4: Manual verification**

No live DB in this environment by default — if scratch-DB access is available, POST a test intervention with a `custom_fields` object and confirm via `SELECT form_data FROM assessments WHERE id = <new id>` that it round-trips correctly. If not available, trace the code change manually (confirm `custom_fields` flows from destructure to the JSON.stringify call unchanged) and report as DONE_WITH_CONCERNS.

- [ ] **Step 5: Commit**

```bash
git add backend/index.js
git commit -m "Store custom dropdown field values in assessments.form_data"
```

---

### Task 7: Frontend web — LogInterventionModal.jsx renders custom category fields

**Files:**
- Modify: `frontend/src/components/LogInterventionModal.jsx`

**Interfaces:**
- Consumes: `categories` from Task 4's `useDropdownOptions()`; `useDropdownOptions().options[categoryKey]` for each custom category's own code/label rows.

- [ ] **Step 1: Read the full current file**

You need the exact current `formData` state shape, its `useEffect` reset logic, the 4 existing `<select>` renders, and `handleSubmit`'s payload construction (which currently spreads `...formData` wholesale into the POST body).

- [ ] **Step 2: Fetch categories and derive the active custom ones**

```js
const { options: dropdownOptions, categories } = useDropdownOptions();
const customCategories = categories.filter((c) => c.is_custom && c.is_active);
```

- [ ] **Step 3: Track custom field values in formData under a nested key**

Extend the `formData` initial state (and its reset in the `useEffect`'s `else` branch) to include:

```js
customFields: {},
```

- [ ] **Step 4: Render one select per active custom category**

Add, after the existing Group Size Category `<select>` (inside or alongside the existing 4-field grid — widen the grid or wrap in a new row, matching this file's existing Tailwind grid conventions):

```jsx
{customCategories.map((cat) => {
  const catOptions = activeOnly(dropdownOptions[cat.key] || []);
  return (
    <div key={cat.key}>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {cat.display_name}{cat.is_required_on_log && ' *'}
      </label>
      <select
        value={formData.customFields[cat.key] || ''}
        onChange={(e) => setFormData((f) => ({ ...f, customFields: { ...f.customFields, [cat.key]: e.target.value } }))}
        required={cat.is_required_on_log}
        className="w-full h-10 rounded-md border border-slate-300 px-3 text-sm"
      >
        <option value="">Select...</option>
        {catOptions.map(({ code, label }) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
    </div>
  );
})}
```

(Match the exact className/styling conventions of the 4 existing `<select>` elements in this file rather than the illustrative classes above — read them in Step 1 and copy their real classes.)

- [ ] **Step 5: Include customFields in the submit payload**

Since `handleSubmit` already spreads `...formData` into the POST payload, `formData.customFields` is automatically included as a nested object — but the backend (Task 6) expects a top-level `custom_fields` key, not nested under whatever `formData`'s own top-level key is. Adjust the payload construction to rename it:

```js
const payload = {
  ...formData,
  custom_fields: formData.customFields,
};
delete payload.customFields; // avoid sending both the nested-name and renamed-key versions
```

(Insert this right before the existing `api.post('/api/interventions', payload)` call, adapting to the exact variable name the current code already uses for the payload object.)

- [ ] **Step 6: Verify**

Run the project's frontend build/lint command and confirm no new errors.

- [ ] **Step 7: Manual verification**

No live DB/server in this environment by default — do a careful manual trace: confirm a required custom category actually blocks form submission (via the `required` attribute) the same way the existing fixed fields do, and confirm the payload's `custom_fields` key ends up shaped as `{ "<key>": "<code>" }` for each filled-in custom field. Report as DONE_WITH_CONCERNS if live verification isn't possible.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/LogInterventionModal.jsx
git commit -m "Render custom dropdown categories in the web log-entry form"
```

---

### Task 8: Mobile — LogIntervention.tsx renders custom category fields

**Files:**
- Modify: `mobile/src/pages/LogIntervention.tsx`
- Modify: `mobile/src/contexts/AppDataContext.tsx`

**Interfaces:**
- Consumes: whatever `AppDataContext` exposes after being extended to also provide `categories` and per-category options, mirroring Task 4's web hook.

- [ ] **Step 1: Read both files in full**

`AppDataContext.tsx` currently fetches `/api/dropdown-options` and computes `serviceTypeOptions`/`statusOptions`/`locationOptions`/`groupSizeOptions` off it (per prior exploration, around line 217-221) — read the surrounding code to find exactly how/where it does this and where the context's provided value object is assembled.

- [ ] **Step 2: Extend AppDataContext to also fetch and expose categories**

Add a fetch to `/api/dropdown-options/categories` (mirroring however the existing `/api/dropdown-options` fetch is done in this file — same API client, same error handling), store the result, and add `categories` (and a way to get a given custom category's own options, e.g. `dropdownOptions[key]`) to the context's provided value.

- [ ] **Step 3: Extend LogIntervention.tsx's FormState and form state**

Add `customFields: Record<string, string>` to the `FormState` interface, and `customFields: {}` to the initial `form` state object.

- [ ] **Step 4: Render one Picker per active custom category**

In the "codes" section (alongside the existing Service Type/Status/Location/Group Size `<Picker>` elements), add one `<Picker>` per active custom category from the context, following the exact same component/prop pattern the 4 existing pickers use (`options={...}`, value/onChange bound to `form.customFields[key]`).

- [ ] **Step 5: Add required-field validation for required custom categories**

The existing `missing` validation array (built before submit) needs one more check per category where `is_required_on_log` is true and `form.customFields[key]` is empty — mirror however the existing 4 fields' required-checks are expressed there.

- [ ] **Step 6: Explicitly add customFields to the submit payload**

Unlike the web modal, this screen's `handleSubmit` builds its POST body as an **explicit object literal**, not a spread of `form` — so `custom_fields: form.customFields` must be added as an explicit key in that object literal (find the exact current object literal, e.g. around where `groupSizeCategory: form.groupSizeCategory` appears, and add the new key alongside it).

- [ ] **Step 7: Verify**

Run whatever this project's mobile build/typecheck command is (check `mobile/package.json` for the actual script — likely `tsc --noEmit` or an Expo/React Native build command) and confirm no new errors introduced by this change.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/pages/LogIntervention.tsx mobile/src/contexts/AppDataContext.tsx
git commit -m "Render custom dropdown categories in the mobile log-entry form"
```

---

### Task 9: Backend — generic label-to-code mapping for custom categories

**Files:**
- Modify: `backend/src/constants/njeis.js`

**Interfaces:**
- Consumes: `getDropdownOptionsCache` (already imported in this file).
- Produces: `mapCategoryLabelToCode(category, label, threshold)` — a new, generic version of the pattern `mapLocationLabelToCode`/`mapGroupSizeLabelToCode` already follow — consumed by Task 12's billingController.js comparison branch.

- [ ] **Step 1: Add the new generic function**

Add this alongside the existing 4 hand-written `mapXLabelToCode` functions — do NOT modify or refactor those 4 existing functions. `mapServiceLabelToCode` has a special-cased `SERVICE_LABEL_OVERRIDES` list and `mapStatusLabelToCode` has an extra exact-code-match check that a generic function for arbitrary custom categories shouldn't blindly inherit (a custom category has no equivalent domain-specific overrides) — so this task adds ONE new function rather than collapsing the existing 4 into it, to avoid any risk of regressing NJEIS-critical matching behavior for zero benefit:

```js
// Generic version of the mapXLabelToCode pattern above, for any custom
// (admin-created) dropdown category — deliberately does NOT carry
// service_type's SERVICE_LABEL_OVERRIDES or service_status's extra
// exact-code-match rule, since those are domain-specific to NJEIS's fixed
// vocabulary and have no equivalent meaning for an arbitrary custom field.
function mapCategoryLabelToCode(category, label, threshold = 1) {
  if (!label) return null;
  const options = activeOptions(category);
  const n = norm(label);
  const exact = options.find((o) => norm(o.label) === n);
  if (exact) return exact.code;
  const scored = scoredWordMatch(label, options, threshold);
  return scored ? scored.code : null;
}
```

- [ ] **Step 2: Harden activeOptions against an unknown/not-yet-cached category**

`activeOptions(category)` currently does `getDropdownOptionsCache()[category].filter(...)` with no guard — if called for a category key that isn't in the cache (e.g. a race right after a category was created but before the cache refreshed), this throws. Add a guard:

```js
const activeOptions = (category) =>
  (getDropdownOptionsCache()[category] || []).filter((o) => o.is_active).map((o) => ({ code: o.code, label: o.label }));
```

- [ ] **Step 3: Add mapCategoryLabelToCode to module.exports**

- [ ] **Step 4: Verify syntax**

Run: `node --check backend/src/constants/njeis.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add backend/src/constants/njeis.js
git commit -m "Add generic label-to-code mapping for custom dropdown categories"
```

---

### Task 10: Backend — compareTo validation accepts custom categories

**Files:**
- Modify: `backend/src/controllers/companyController.js`

**Interfaces:**
- Consumes: `dropdown_categories` table (Task 1) via a new query.
- Produces: `applyComplianceDocMapping`'s `compareTo` validation now accepts `custom_category:<key>` for any active custom category, in addition to the existing 8 fixed values.

- [ ] **Step 1: Read the full applyComplianceDocMapping function**

You need its exact current structure around `VALID_CUSTOM_FIELD_COMPARE_TO` to edit it correctly.

- [ ] **Step 2: Extend the compareTo validation to also check custom categories**

Replace the plain `VALID_CUSTOM_FIELD_COMPARE_TO.includes(cf.compareTo)` check with one that also accepts a dynamic custom-category value:

```js
const VALID_CUSTOM_FIELD_COMPARE_TO = [
  'service_type', 'location', 'group_size',
  'service_status', 'total_time', 'practitioner_discipline', 'patient_dob', 'patient_county',
];

const { rows: customCategoryRows } = await pool.query(
  "SELECT key FROM dropdown_categories WHERE is_custom = true AND is_active = true"
);
const validCustomCategoryCompareTos = customCategoryRows.map((r) => `custom_category:${r.key}`);
const isValidCompareTo = (value) =>
  VALID_CUSTOM_FIELD_COMPARE_TO.includes(value) || validCustomCategoryCompareTos.includes(value);

const customFields = Array.isArray(rawCustomFields)
  ? rawCustomFields.filter((cf) => cf && cf.label && cf.header).map((cf) => ({
      label: String(cf.label).trim(),
      header: String(cf.header),
      compareTo: isValidCompareTo(cf.compareTo) ? cf.compareTo : null,
    }))
  : [];
```

(This query must run against the CURRENT tenant's pool — confirm this function already uses the tenant-scoped `pool` import, same as every other query in this file, so no additional tenant-context plumbing is needed.)

- [ ] **Step 3: Verify syntax**

Run: `node --check backend/src/controllers/companyController.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/companyController.js
git commit -m "Accept custom dropdown categories as a compareTo target in compliance-doc mapping"
```

---

### Task 11: Frontend — compareTo picker lists custom categories

**Files:**
- Modify: `frontend/src/components/CompanySettings.jsx`

**Interfaces:**
- Consumes: `GET /api/dropdown-options/categories` (Task 3) — this component doesn't currently use `useDropdownOptions()`, so it needs its own fetch or to adopt that hook.

- [ ] **Step 1: Read the full compareTo `<select>` section and surrounding state**

You need the exact current JSX (the 8 hardcoded `<option>` elements) and this component's existing state-management conventions to add a fetch consistently.

- [ ] **Step 2: Fetch custom categories**

Add a fetch to `/api/dropdown-options/categories` (either via the shared `useDropdownOptions()` hook — simplest, since Task 4 already added `categories` to it — or a standalone `api.get` call if adopting the hook here would require unrelated restructuring; prefer the hook unless doing so conflicts with this component's existing patterns). Filter to `is_custom && is_active`.

- [ ] **Step 3: Extend the compareTo select's options**

```jsx
<select ...>
  <option value="">— Informational only —</option>
  <optgroup label="Categories">
    <option value="service_type">Service Type</option>
    <option value="location">Location</option>
    <option value="group_size">Group Size Category</option>
    <option value="service_status">Service Status</option>
    <option value="total_time">Total Time</option>
    <option value="practitioner_discipline">Practitioner Discipline</option>
    <option value="patient_dob">Patient DOB</option>
    <option value="patient_county">Patient County</option>
  </optgroup>
  {customCategories.length > 0 && (
    <optgroup label="Custom Categories">
      {customCategories.map((cat) => (
        <option key={cat.key} value={`custom_category:${cat.key}`}>{cat.display_name}</option>
      ))}
    </optgroup>
  )}
</select>
```

(Keep the existing 8 fixed `<option>` elements completely unchanged — only add the new conditional `<optgroup>`.)

- [ ] **Step 4: Verify**

Run the project's frontend build/lint command and confirm no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CompanySettings.jsx
git commit -m "List custom dropdown categories in the compareTo picker"
```

---

### Task 12: Backend — Compliance Analysis comparison branch for custom categories

**Files:**
- Modify: `backend/src/controllers/billingController.js`

**Interfaces:**
- Consumes: `mapCategoryLabelToCode` from Task 9; `codeLabel`-equivalent generic lookup (already exists in `njeis.js` as `codeLabel(category, code)`, exported? — check and export it if not already, since this task needs it directly rather than via one of the 4 category-specific wrappers).

- [ ] **Step 1: Read the full field-comparison block (roughly lines 960-1201) and confirm codeLabel's export status**

Check `backend/src/constants/njeis.js`'s `module.exports` — if the generic `codeLabel(category, code)` helper (not just its 4 per-category wrappers `serviceCodeLabel`/`locationCodeLabel`/etc.) is not currently exported, add it to `module.exports` in this same file edit (small addition, since Task 9 already touched this file — but if Task 9 is already complete and committed, this becomes a small follow-up edit here instead; check the current state first).

- [ ] **Step 2: Add the new comparison branch**

Inside the `Object.entries(match.extra_fields || {}).map(([label, value]) => { ... })` block, add a new branch checking for the `custom_category:` prefix, inserted before the final informational fallback (`return { key: \`custom:${label}\`, ... }`):

```js
if (compareTo && compareTo.startsWith('custom_category:')) {
  const categoryKey = compareTo.slice('custom_category:'.length);
  const ourCode = session.form_data?.custom_fields?.[categoryKey] || null;
  const stateCode = mapCategoryLabelToCode(categoryKey, value, matchParams.wordOverlapThreshold);
  return {
    key: `custom:${label}`, label,
    ours: ourCode ? codeLabel(categoryKey, ourCode) : null,
    state: stateCode ? codeLabel(categoryKey, stateCode) : value,
    match: !!ourCode && !!stateCode && ourCode === stateCode,
  };
}
```

(Insert this as one more `if` branch in the existing chain, following the exact same shape as the `compareTo === 'service_type'` branch earlier in the same map callback — read that branch first in Step 1 and match its structure precisely, including where `session` and `matchParams` come from in this function's scope.)

- [ ] **Step 3: Import mapCategoryLabelToCode and codeLabel**

Check this file's existing import from `../constants/njeis` (it already imports `mapServiceLabelToCode` etc. per prior exploration) and add `mapCategoryLabelToCode, codeLabel` to that same import line.

- [ ] **Step 4: Verify syntax**

Run: `node --check backend/src/controllers/billingController.js`
Expected: no output.

- [ ] **Step 5: Manual verification**

No live DB in this environment by default — trace through manually: a log with `form_data.custom_fields.insurance_type = 'PPO'`, a state Excel row with an "Insurance" column mapped to `compareTo: 'custom_category:insurance_type'` and raw text `"PPO Plan"`, and a dropdown option `(code: 'PPO', label: 'PPO Plan')` under the `insurance_type` category — confirm the trace produces `match: true` (exact label match after `mapCategoryLabelToCode`'s `norm()` comparison). Report as DONE_WITH_CONCERNS if live verification isn't possible.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/billingController.js backend/src/constants/njeis.js
git commit -m "Add Compliance Analysis comparison support for custom dropdown categories"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — data model (Task 1), backend category CRUD (Task 3), Dropdown Options tab UI (Task 5), log-form integration web+mobile (Tasks 6-8), Compliance Analysis compareTo integration (Tasks 9-12), permissions (no new task needed — reused `company_info_dropdown_options`/`company_info_compliance_doc` throughout, confirmed in Tasks 3/10).
- **Placeholder scan:** Task 3's Step 3 intentionally leaves one line as a "fill in exactly, matching the real file" placeholder rather than guessing at an import path that could be wrong — this is flagged explicitly as "read the real file first," the same pattern the Phase 2 plan used for its own genuinely file-dependent unknowns, not a vague "add appropriate X" placeholder.
- **Type/signature consistency:** `custom_category:<key>` is used identically across Tasks 10 (backend validation), 11 (frontend picker), and 12 (comparison branch) — confirmed no naming drift. `custom_fields` (snake_case, top-level POST body key) is used identically across Tasks 6, 7, and 8's payload construction. `mapCategoryLabelToCode(category, label, threshold)`'s signature (Task 9) matches its call site in Task 12 exactly (3 positional args, same order as the 4 existing hand-written functions it mirrors).
- **Deviation from spec flagged inline:** the spec's Compliance-Analysis section said the 4 existing label-mapping functions would be "refactored into one shared function." Task 9 instead ADDS a new function without touching the 4 existing ones, because two of them (`mapServiceLabelToCode`'s interpreter override, `mapStatusLabelToCode`'s extra exact-code match) have NJEIS-specific special-casing that a generic function for arbitrary custom categories has no business inheriting — forcing a shared implementation would mean either losing that special-casing (regressing real NJEIS matching behavior) or leaking custom-category logic with irrelevant special cases. Achieves the same practical outcome (one generic function available for any custom category) with strictly lower regression risk on production-critical code.
