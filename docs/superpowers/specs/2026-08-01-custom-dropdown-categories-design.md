# Plan: Custom Dropdown Categories

## Context

Today, "Dropdown Options" (under Company Information) manages exactly 4 hardcoded, state-mandated categories — Service Type, Service Status, Location, Group Size — each a fixed set of `(code, label)` pairs stored in `dropdown_options`, enforced by a `CHECK (category IN (...))` constraint. These categories are wired throughout the app: the session-logging form, NJEIS billing-code generation, and the Compliance Analysis Excel-matching engine.

The product owner wants agencies to be able to define their *own* additional dropdown categories (e.g., "Insurance Type," "Referral Source") that show up as extra fields when a practitioner logs a session — without those custom categories participating in NJEIS state-form generation or billing math (which stays driven only by the 4 existing categories). They should, however, be usable as a comparison factor in the existing Compliance Analysis Excel-matching feature, the same way an office can already map an extra Excel column against Service Type/Location/etc. today.

Explicitly out of scope: automatically detecting fields from an arbitrary uploaded state PDF form via `pdf-lib` and auto-generating dropdowns from that. That's Phase 4 of the original 5-phase multi-tenant roadmap and is its own project — not touched here.

## Data model

New table, `dropdown_categories`, the registry of every dropdown category (built-in and custom):

```sql
CREATE TABLE dropdown_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,              -- slug, e.g. 'service_type' or 'insurance_type'
  display_name text NOT NULL,            -- e.g. "Service Type", "Insurance Type"
  is_custom boolean NOT NULL DEFAULT true, -- false for the 4 built-ins
  is_required_on_log boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Seeded with the 4 built-ins (`is_custom = false`, `key` matching today's literal `category` values, `sort_order` 0-3 matching their current tab order).

`dropdown_options.category` (currently `text` with a `CHECK` restricting it to the 4 literals) has that CHECK constraint dropped and gains a foreign key: `category` references `dropdown_categories.key`. No other column on `dropdown_options` changes — the existing CRUD (add/rename/reactivate/deactivate a code+label row) already operates generically per-category and needs no changes.

Built-in categories (`is_custom = false`) cannot be renamed or deleted via the API — mirroring the fixed/non-editable Admin role pattern from Phase 2. Custom categories are fully editable, including deletion (blocked if any logged session still references that category's key in `form_data.custom_fields`, or if any compliance-doc mapping still points a `compareTo` at it — see below).

## Backend API

New routes, gated by the existing `company_info_dropdown_options` permission (no new permission key):
- `GET /api/dropdown-categories` — list all categories (built-in + custom), each with its options nested or fetched separately (matching whatever shape the existing dropdown-options endpoints already use).
- `POST /api/dropdown-categories` — create a custom category: `{ displayName, isRequiredOnLog }`. Server generates `key` by slugifying `displayName` (lowercase, non-alphanumeric → underscore, collision-checked against existing keys).
- `PATCH /api/dropdown-categories/:id` — rename, toggle `isRequiredOnLog`, or reorder a custom category. Rejected for built-ins (`is_custom = false`).
- `DELETE /api/dropdown-categories/:id` — delete a custom category. Rejected for built-ins, and rejected with a clear error if any compliance-doc custom-field mapping still has `compareTo` pointed at this category's key (must be un-mapped first).

The existing dropdown-option row endpoints (`POST/PUT/DELETE /api/dropdown-options/:id`, etc.) are unchanged — they already take a `category` value in their request body/route and just need that value to be looked up against `dropdown_categories` instead of the old hardcoded list.

## Frontend: Dropdown Options tab UI

The existing Dropdown Options screen gains a row of sub-tabs, one per `dropdown_categories` row ordered by `sort_order`: Service Type, Service Status, Location, Group Size (unchanged, in their current order), followed by any custom categories, followed by a trailing **"+"** tab.

Clicking "+" opens a small inline form: category name (required text input) and a "Required when logging a session" checkbox. Submitting creates the category (`POST /api/dropdown-categories`) and switches into its tab, which renders the same code/name table UI already used for the 4 built-ins — that table component is parameterized by category key rather than hardcoded, so no new table UI is built.

A custom category's tab also shows a "Delete category" action (not present on built-in tabs), with the same confirm-dialog pattern established elsewhere in this app (`showConfirm`, not a native `window.confirm`).

## Frontend/backend: log-entry form integration

`useDropdownOptions` (the shared hook `LogInterventionModal.jsx`, `dashboard.jsx`, and the mobile equivalent all already use) is extended to also expose active custom categories — not just the 4 fixed buckets it returns today.

`LogInterventionModal.jsx` (web) and its mobile equivalent render one additional `<select>` per active custom category, below the existing Service Type/Status/Location/Group Size fields, labeled with the category's `display_name`, populated from its own active `(code, label)` rows. A category with `is_required_on_log = true` gets the same required-field validation the built-in fields already have; others are optional and skippable.

On submit, chosen custom values are bundled as `{ "<category_key>": "<code>" }` into a new `custom_fields` key inside `assessments.form_data` (a JSONB column that exists today but is always saved as an empty object — no migration needed to start using it). Every other piece of code that reads a log's core fields (`type`, `location`, `group_size_category`, `status`, etc.) is untouched; only new code that specifically looks for custom-field values reaches into `form_data.custom_fields`.

## Backend: Compliance Analysis / Excel-comparison integration

Today, `companyController.js`'s compliance-doc-mapping endpoint validates each extra Excel column's optional `compareTo` against a fixed allowlist, `VALID_CUSTOM_FIELD_COMPARE_TO = ['service_type', 'location', 'group_size', 'service_status', 'total_time', 'practitioner_discipline', 'patient_dob', 'patient_county']`. This list is extended at request time to also accept `custom_category:<key>` for every active custom category in the tenant's `dropdown_categories` table (validated against the DB, not a static array, since custom categories are per-tenant and dynamic).

The frontend screen that lets an admin pick a `compareTo` value for an extra Excel column (part of the State Compliance Reference upload/mapping UI) gets its option list extended the same way — the 8 existing fixed options, plus one entry per active custom category, labeled with the category's `display_name`.

On the comparison side, `billingController.js`'s per-log field-by-field diff (the `...Object.entries(match.extra_fields || {}).map(...)` block) gains one more branch: when `compareTo` matches `custom_category:<key>`, look up the session's stored value at `session.form_data?.custom_fields?.[key]`, map it to its label via the category's own active options, and compare against the Excel's raw text for that mapped column — producing a genuine match/mismatch verdict (not the "informational only" treatment today's *other* kind of custom field gets when it has no `compareTo`).

This reuses the same label-matching logic every built-in field already applies (exact match, then fuzzy word-overlap match) rather than duplicating it: `backend/src/constants/njeis.js`'s four near-identical functions (`mapServiceLabelToCode`, `mapLocationLabelToCode`, `mapGroupSizeLabelToCode`, `mapStatusLabelToCode`) are refactored into one shared `mapCategoryLabelToCode(category, label, threshold)` that all four (and the new custom-category branch) call — since `activeOptions(category)` (which all four already use, via `getDropdownOptionsCache()[category]`) is already fully generic and requires no changes to work for a custom category's key.

## Testing / verification

This codebase has no automated test framework (confirmed absent, consistent with Phase 2's implementation). Verification follows the same pattern established there: `node --check` on every modified backend file, `eslint`/`npm run build` on every modified frontend file, plus manual tracing/scratch-database verification for anything schema-related — given Phase 2's migration bug was caught in production specifically because a schema change wasn't tested against a real database, the `dropdown_categories` migration for this feature must be verified against a real Postgres instance (a throwaway scratch database, not production) before deployment, seeded with the 4 existing built-in categories' current shape, confirming: the migration is idempotent, existing dropdown options keep working unchanged, and a newly created custom category's options round-trip correctly.

Functional checks:
1. Create a custom category, confirm it appears as a required or optional field (per its checkbox) in both the web and mobile log-entry forms.
2. Log a session with a custom field filled in, confirm the value round-trips (visible wherever a submitted log's details are later reviewed).
3. Map an Excel column's `compareTo` to a custom category, upload a state Excel with that column, run Compliance Analysis, confirm a genuine match/mismatch verdict appears for that field (not just "informational").
4. Confirm a built-in category (Service Type, etc.) cannot be renamed or deleted via the API.
5. Confirm deleting a custom category still in use by a `compareTo` mapping is rejected with a clear error.
6. Confirm the 4 built-in categories' existing behavior (tab order, code/name management, log-form rendering, NJEIS billing-code generation) is completely unchanged.
