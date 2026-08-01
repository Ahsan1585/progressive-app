# Plan: Phase 2 — Role & Permission System

## Context

Phase 1 (multi-tenant foundation) is deployed. Every office-staff account today has one of 4 hardcoded roles (`ceo`, `staff_director`, `billing`, `account_specialist`) plus the separate `practitioner` role, and authorization is a scattered set of `requireRole(['ceo', 'billing', ...])` allowlists across ~18 backend routes and a `TAB_ACCESS` map in `frontend/src/pages/AdminDashboard.jsx`. Adding or adjusting what a role can do currently requires a code change and a deploy.

This phase replaces that with a per-tenant, admin-editable role system: prebuilt role labels (Account Specialist, Billing Specialist, Program Coordinator, Staff Director) plus fully custom roles, each with an independently editable checklist of granular permissions. `practitioner` is explicitly out of scope — this system only governs office/admin-side accounts.

## Scope decisions (confirmed with product owner)

- **Admin-side only.** Practitioner accounts and their access are untouched by this phase.
- **Roles are reusable named entities, not per-person overrides.** Editing a role's permission checklist immediately changes access for every staff member holding that role.
- **New roles default to minimal access** (`staff_directory_view` only) — there is no hardcoded "what a Billing Specialist should be able to do"; the admin decides per their own agency's needs.
- **Admin is a fixed, non-editable, always-full-access system role.** It can't be edited, renamed, or deleted, and always resolves to every permission. This is a deliberate safety rail: it guarantees an agency can never configure itself into having zero staff with full access.
- **Permission changes take effect immediately**, not on next login — if an admin revokes someone's billing access, that takes effect on their very next request, matching the precedent already set by the Phase 1 trial/BAA gate (which also re-checks live on every request rather than trusting a JWT snapshot).

## Data model

New tables, per tenant database:

```sql
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,   -- true only for the seeded "Admin" row
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);
```

`practitioners` gains `role_id uuid REFERENCES roles(id)`, nullable (NULL for practitioner-role accounts, which don't participate in this system).

The existing `practitioners.role` text column (CHECK-constrained today to the 5 legacy values) is **kept, not dropped**, and its meaning narrows rather than disappears:
- `'ceo'` — the one fixed, always-full-access account (equivalent to the new system "Admin" role). Still used by the handful of infra-level checks that only ever cared about ceo-vs-not: the Phase 1 trial/BAA-gate ceo-exception, self-deletion guard, JWT payload.
- `'practitioner'` — unchanged.
- `'staff'` — a new catch-all value for every other office account, regardless of their actual custom role title. Replaces `'staff_director'`/`'billing'`/`'account_specialist'` as literal values going forward (existing rows get backfilled during migration).

This additive approach means the small number of places that already do `req.practitioner.role === 'practitioner'` or `=== 'ceo'` keep working unmodified. Anywhere that today branches on the old 3 fine-grained staff values gets rewritten to check `req.permissions` instead (see Enforcement).

### Permission catalog

Derived from the product owner's original list, cross-checked against every existing `requireRole` guard in the codebase so nothing currently reachable becomes orphaned and nothing currently blocked becomes accidentally open:

| Permission key | Replaces today's guard on |
|---|---|
| `staff_directory_view` | GET staff list/detail |
| `staff_directory_edit` | PATCH staff profile fields (name, contact, pay rate, etc.) |
| `staff_directory_edit_role` | PATCH staff role, deactivate, reactivate — kept separate from general edit since it's more sensitive |
| `register_new_user` | POST register-practitioner (invite flow) |
| `master_reports` | Master Reports tab/routes |
| `billing_pending` | Pending Bills tab: logs, notes, compliance analysis, accept/reject, reconcile, generate NJEIS/invoice, complete billing, lock/unlock practitioner |
| `billing_completed` | Completed Bills tab: history, batches, revert-batch, downloads |
| `billing_invoice_status` | Invoice Status tab: mark printed/paid |
| `subscription_billing` | Subscription & Billing tab/routes |
| `company_info_compliance_doc` | Uploading/managing the state compliance reference document |
| `company_info_dropdown_options` | Managing dropdown options |
| `audit_logs` | Audit log viewing |
| `action_required_approve` | Action Required tab: deciding on logs missing from state records |

Two existing ceo-only levers (compliance-matching strictness setting, and company branding/basic-info writes) stay hardcoded as Admin-exclusive rather than becoming their own checkboxes — they're agency-wide policy levers in the same vein as subscription management, not day-to-day staff workflow permissions, and adding them to the checklist would create a way for an agency to accidentally strip Admin-level control away from itself if Admin were ever editable (it isn't, but keeping these out of the granular list avoids ambiguity about where the line is).

## Enforcement mechanism

Today, `req.practitioner.role` comes straight from the JWT and `requireRole([...])` checks it in-memory, no DB round-trip. Because permission edits must take effect immediately (not on next login), permission checks move to a **fresh per-request lookup**, mirroring the pattern the Phase 1 trial/BAA gate already established for the same reason.

- New middleware, `loadPermissions`, runs immediately after `protect` (which already resolves the tenant DB via `runWithTenant`). It queries the current practitioner's `role_id`, and if the role `is_system` (Admin), short-circuits to "all permissions granted"; otherwise it loads that role's `role_permissions` rows into `req.permissions` (a `Set<string>`).
- New guard, `requirePermission('billing_pending')`, replaces `requireRole([...])` at each of the ~18 route declarations — checks `req.permissions.has(key)` (or always passes for Admin/ceo).
- This adds one query per authenticated request (a join: practitioner → role → role_permissions), the same order of overhead already accepted for the trial/BAA platform-DB check — not a new category of cost, just the same tradeoff applied a second time for the same reason (correctness/immediacy over one extra round-trip).
- Because a practitioner's `role_id` is also read fresh every request (not from the JWT), a role *re-assignment* (not just a permission edit) also takes effect immediately — an admin demoting someone mid-session works exactly like revoking a permission does.

## Role management API & UI

New backend routes, all gated by `requirePermission('staff_directory_edit_role')` except where noted:
- `GET /api/roles` — list roles + their permission sets (available to anyone who can reach the staff directory, needed to populate the "assign role" dropdown).
- `POST /api/roles` — create a role (name + initial permission set).
- `PATCH /api/roles/:id` — rename / change permission set. Rejected with a clear error if `id` is the system Admin role.
- `DELETE /api/roles/:id` — rejected if the role is Admin, or if any practitioner currently holds it (must reassign staff first — same "can't delete what's in use" pattern as other entities in this app).

New frontend screen, `frontend/src/pages/RoleManagement.jsx` (or a new tab within `AdminDashboard.jsx`, following its existing tab-shell pattern): a list of roles, each expandable to its permission checklist (grouped to mirror the table above: Staff Directory, Billing & Invoices, Company Information, etc.), with a "New Role" action that starts from the minimal default. The existing hardcoded `TAB_ACCESS` map in `AdminDashboard.jsx` is replaced with checks against the permission keys returned by `/api/auth/company-status`-equivalent (or a new lightweight `GET /api/auth/me` that includes the current user's resolved permission set) — each tab's visibility becomes `permissions.has('billing_pending')` etc. instead of `TAB_ACCESS[role].includes(tab)`.

The "assign role" dropdown, wherever staff accounts are created/edited (`register_new_user` / staff PATCH forms), switches from the old fixed `<select>` of 4 role strings to populate from `GET /api/roles`.

## Migration (Progressive Steps NJ + future tenants)

For every existing tenant (just Progressive today) and baked into the same per-tenant migration runner used in Phase 1 (`runMigrations.js`'s loop over all companies):
1. Create the `roles` / `role_permissions` tables.
2. Seed one `is_system = true` "Admin" row (no explicit `role_permissions` rows needed — Admin's "all permissions" comes from the `is_system` flag, not enumeration, so the catalog can grow later without a migration).
3. Seed the 4 prebuilt labels (Account Specialist, Billing Specialist, Program Coordinator, Staff Director) each with only `staff_directory_view` — BUT for the existing Progressive tenant specifically, backfill each seeded role's permissions to **match what that role could already do today** (i.e., migrate existing `staff_director`/`billing`/`account_specialist` accounts onto equivalent permission sets derived from today's `requireRole` guards), so the cutover is behavior-preserving and no existing staff member's access silently narrows the moment this deploys. Brand-new tenants signing up after this phase ships get the true minimal default.

   Concrete mapping for Progressive's 3 existing office roles, derived directly from today's `requireRole` guards (no manual reconfiguration needed at cutover):
   - **Staff Director** → `staff_directory_view`, `staff_directory_edit`, `staff_directory_edit_role`, `register_new_user`
   - **Billing** → `billing_pending`, `billing_completed`, `billing_invoice_status`
   - **Account Specialist** → `staff_directory_view`, `staff_directory_edit`, `register_new_user`, `billing_pending`, `billing_completed`, `billing_invoice_status`

   Every existing practitioner row's `role` value maps onto the corresponding seeded role automatically; no Progressive staff member's access changes at deploy time.
4. Backfill every existing practitioner row's `role_id` to point at the matching seeded role (by their current `role` value), and update their `role` text column to `'ceo'` (unchanged), `'practitioner'` (unchanged), or `'staff'` (for the 3 old fine-grained values).
5. New signups (`signupController.js`'s `confirmSignup`) seed the same Admin + 4-prebuilt-with-minimal-default set as step 2/3 (minus the Progressive-specific backfill in step 3), so every new company starts from the same clean slate.

## Testing / verification

1. `node --check` on every new/modified backend file.
2. Confirm Admin role cannot be edited/deleted/renamed via the API (403/400 as appropriate).
3. Confirm a custom role's permission edit takes effect on the very next request from an already-logged-in user holding that role — no re-login required (the core "immediate effect" requirement).
4. Confirm the Progressive Steps NJ migration preserves existing staff members' access exactly (spot-check a `staff_director` and a `billing` account's accessible routes/tabs before and after deploy).
5. Confirm a brand-new tenant's 4 prebuilt roles start with only `staff_directory_view` and nothing else.
6. Confirm deleting a role that's still assigned to a practitioner is rejected with a clear error.
7. Confirm every one of the 13 permission keys maps to at least one enforced route (no dead/unused key, no route left unguarded).
8. Frontend: log in as a custom role with e.g. only `billing_pending` checked, confirm only that tab is visible/reachable in `AdminDashboard.jsx`, and confirm the underlying route also rejects direct API calls (defense in depth — never rely on frontend hiding alone).

## Out of scope for this phase

- Practitioner-side permissions (unchanged, fixed system role).
- Per-individual permission overrides layered on top of a role (if ever needed, a future phase — this phase is role-level only, matching the "reusable role" decision above).
- Company setup dashboard integration (Phase 3) and anything from Phases 3–5.
