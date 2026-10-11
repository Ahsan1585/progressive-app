# Izaya One: Price Change + Referral Program + Inbox Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop Izaya One's flat price from $30 to $19.99/month (retroactive to existing practitioners), and build a fully automated referral program (referred practitioner's first month free; referrer earns a free month once the referred practitioner's second payment succeeds), surfaced via a new "Referral program" mobile screen and a new notification item type inside the existing Inbox tab.

**Architecture:** Entirely application-level (no Stripe Subscriptions/Coupons — this codebase charges a flat amount via one-off PaymentIntents per billing cycle). A new platform-DB table (`referral_redemptions`) tracks each referral's lifecycle; a new per-tenant `company_settings.free_months_owed` counter is the actual spendable credit, checked before every charge attempt in the existing `closePeriodInvoice` function. The referrer's reward fires from the existing Stripe webhook handler. A new per-tenant `notifications` table feeds a new Inbox item type, independent-practitioner-only.

**Tech Stack:** Node/Express backend, Postgres (platform DB `izaya_platform` + per-tenant DBs), Stripe (PaymentIntents only), React/Vite frontend (marketing site), React Native-style mobile app (Vite + Tailwind), Resend for email.

**Spec:** `docs/superpowers/specs/2026-10-11-referral-program-and-price-change-design.md`

## Global Constraints

- Tenant-company practitioners and the tenant-company billing path: zero behavior change anywhere in this plan.
- `companies.id` (platform DB) is a `uuid`, not an integer — every new FK to it must be `uuid`.
- Free-month credits are always consumed before any Stripe charge attempt, even with autopay/a saved card active.
- Referral code = the practitioner's existing signup slug. No new code-generation, no manual-entry field anywhere.
- Referred practitioner's first invoice is always fully waived, unconditionally, the moment they sign up via a valid `?ref=` link.
- Referrer's reward fires only after the referred practitioner's **second** invoice is paid via a real Stripe charge (never via a waived invoice) — this is a deliberate anti-fraud delay, not a bug.
- No cap on referral earnings.
- `GET`/`POST` referral and notification routes are independent-practitioner-only (`requireRole(['independent_practitioner'])`, matching `backend/src/routes/billingRoutes.js`'s `independentGuard`).
- Every new user-facing string must use the exact copy from the spec's §2.6 table — do not paraphrase.
- The Inbox tab itself (route, label, icon) must not change for any role. A new item type is additive only.

## Review Focus

- A practitioner signs up with a `?ref=` code pointing to a company that is `cancelled`/non-independent/nonexistent — signup must still succeed, silently ignoring the bad code (never 400/500 the whole signup over it).
- The Stripe webhook's `payment_intent.succeeded` event fires twice for the same PaymentIntent (Stripe's documented at-least-once delivery) — the referrer-reward logic must not double-grant a free month (idempotency via the `referral_redemptions` unique constraint and a null-check on `referrer_rewarded_at`).
- A practitioner refers themselves (signs up using their own slug as `?ref=`) — must be rejected/ignored, not create a self-referential free-month loop.
- `closePeriodInvoice` runs for a tenant with `free_months_owed = 2` (e.g., referred another person while already holding a credit) — must consume exactly one credit per billing cycle, not all of them at once.
- The retroactive price migration runs against a tenant whose `company_settings` row doesn't exist yet (a trial signup that never completed billing setup) — must not error the whole migration script.

---

### Task 1: Retroactive price change to $19.99/month

**Files:**
- Create: `backend/db/migrations/update_independent_flat_price_1999.sql`
- Modify: `backend/db/migrations/add_independent_practitioner_support.sql:99` (the `DEFAULT 30.00` for new signups going forward)
- Modify: `backend/src/utils/subscriptionBilling.js:213` (the `?? 30` fallback in `getFlatSubscriptionSettings`)
- Test: `backend/src/utils/__tests__/subscriptionBilling.test.js` (create if it doesn't exist — check first)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getFlatSubscriptionSettings()` now returns `flatPrice: 19.99` for any tenant whose `company_settings.subscription_flat_price` is NULL or was migrated.

- [ ] **Step 1: Check whether a subscriptionBilling test file already exists**

```bash
ls backend/src/utils/__tests__/subscriptionBilling.test.js 2>/dev/null || echo "does not exist"
```

If it exists, read it in full before continuing so Step 2's test matches the file's existing style (test runner, assertion library, mocking pattern for `pool.query`).

- [ ] **Step 2: Write the failing test for the new fallback price**

If no test file exists, create `backend/src/utils/__tests__/subscriptionBilling.test.js` with:

```js
const { getFlatSubscriptionSettings } = require('../subscriptionBilling');

jest.mock('../../config/db', () => ({
  pool: { query: jest.fn() },
}));
const { pool } = require('../../config/db');

describe('getFlatSubscriptionSettings', () => {
  afterEach(() => jest.clearAllMocks());

  it('falls back to 19.99 when subscription_flat_price is NULL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ subscription_flat_price: null, stripe_customer_id: null, stripe_default_payment_method_id: null, stripe_default_pm_type: null, stripe_default_pm_brand: null, stripe_default_pm_last4: null, stripe_default_pm_exp: null }] });
    const settings = await getFlatSubscriptionSettings();
    expect(settings.flatPrice).toBe(19.99);
  });

  it('uses the stored price when set', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ subscription_flat_price: '24.99', stripe_customer_id: null, stripe_default_payment_method_id: null, stripe_default_pm_type: null, stripe_default_pm_brand: null, stripe_default_pm_last4: null, stripe_default_pm_exp: null }] });
    const settings = await getFlatSubscriptionSettings();
    expect(settings.flatPrice).toBe(24.99);
  });
});
```

If a test file already exists with a different mocking convention, add these two `it(...)` blocks inside its existing `describe('getFlatSubscriptionSettings', ...)` (or a new one) using that file's established pattern instead of the jest.mock shown above.

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx jest src/utils/__tests__/subscriptionBilling.test.js -t "falls back to 19.99"
```

Expected: FAIL (`expected 19.99 received 30`).

- [ ] **Step 4: Update the fallback in subscriptionBilling.js**

In `backend/src/utils/subscriptionBilling.js:213`, change:

```js
    flatPrice: Number(row.subscription_flat_price ?? 30),
```

to:

```js
    flatPrice: Number(row.subscription_flat_price ?? 19.99),
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && npx jest src/utils/__tests__/subscriptionBilling.test.js
```

Expected: PASS (both tests).

- [ ] **Step 6: Update the default for brand-new signups**

In `backend/db/migrations/add_independent_practitioner_support.sql:99`, find the line defining `subscription_flat_price` (currently `DEFAULT 30.00` or similar — read the file first to get the exact surrounding SQL) and change the default to `19.99`. Do not re-run this file manually; it's idempotent migration SQL already applied to existing deployments — this edit only affects brand-new tenant database provisioning going forward (`provisionTenantDatabase` applies the current schema file to every newly created tenant).

- [ ] **Step 7: Write the retroactive migration for existing independent practitioners**

Create `backend/db/migrations/update_independent_flat_price_1999.sql`:

```sql
-- One-time retroactive price drop: $30 -> $19.99/month for every existing
-- independent practitioner, effective their next billing cycle (does not
-- touch already-issued subscription_invoices rows, which keep their
-- original historical amount for audit purposes). This file is NOT run
-- through the per-tenant migration runner (backend/db/migrations/index.js)
-- since company_settings is per-tenant and there is no existing mechanism
-- there for "run once across every tenant" — it is applied by hand, once,
-- per environment (see Task 1 Step 8 for the runner script).
UPDATE company_settings
SET subscription_flat_price = 19.99
WHERE id = 1 AND subscription_flat_price = 30.00;
```

- [ ] **Step 8: Write a one-off Node script to apply the migration across every tenant**

Create `backend/scripts/apply-retroactive-price-change.js`:

```js
// One-time script: applies update_independent_flat_price_1999.sql to every
// existing independent practitioner's own tenant database. Run once per
// environment (staging, then production) after Task 1's other changes are
// deployed. Usage: node backend/scripts/apply-retroactive-price-change.js
const fs = require('fs');
const path = require('path');
const { platformPool } = require('../src/config/platformDb');
const { runWithTenant } = require('../src/config/tenantContext');
const { pool } = require('../src/config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../db/migrations/update_independent_flat_price_1999.sql'),
    'utf8'
  );
  const { rows: companies } = await platformPool.query(
    `SELECT slug, tenant_db_name FROM companies WHERE account_type = 'independent'`
  );
  console.log(`Found ${companies.length} independent practitioner tenant(s).`);
  let updated = 0;
  for (const company of companies) {
    try {
      await runWithTenant(company.tenant_db_name, async () => {
        const result = await pool.query(sql);
        if (result.rowCount > 0) {
          updated += 1;
          console.log(`  ${company.slug}: updated to $19.99`);
        } else {
          console.log(`  ${company.slug}: no change (already non-$30, or company_settings missing)`);
        }
      });
    } catch (err) {
      console.error(`  ${company.slug}: FAILED — ${err.message}`);
    }
  }
  console.log(`Done. ${updated}/${companies.length} tenants updated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
```

Note: a tenant whose `company_settings` row doesn't exist yet (Review Focus item 5) is handled safely here — `pool.query(sql)` against a missing/empty table matches zero rows, `result.rowCount` is `0`, the loop logs "no change" and continues; it never throws.

- [ ] **Step 9: Commit**

```bash
git add backend/db/migrations/update_independent_flat_price_1999.sql backend/db/migrations/add_independent_practitioner_support.sql backend/src/utils/subscriptionBilling.js backend/src/utils/__tests__/subscriptionBilling.test.js backend/scripts/apply-retroactive-price-change.js
git commit -m "Drop Izaya One flat price to \$19.99/month, with retroactive migration script"
```

**Do not run `apply-retroactive-price-change.js` yet** — it runs against real tenant databases and is deferred to a final deploy-and-verify task (Task 10) after everything else is reviewed.

---

### Task 2: Referral data model (platform DB + per-tenant columns)

**Files:**
- Create: `backend/db/migrations/add_referral_program.sql`
- Modify: `backend/db/platform-schema.sql` (document the new `companies.referred_by_company_id` column and `referral_redemptions` table — this file is the platform DB's own schema reference, separate from the per-tenant migration runner)
- Modify: `backend/db/migrations/index.js` (register the new per-tenant migration)

**Interfaces:**
- Produces: `companies.referred_by_company_id` (uuid, nullable), `referral_redemptions` table (platform DB), `company_settings.free_months_owed` (per-tenant, integer), `subscription_invoices.waived_by_referral` (per-tenant, boolean).

- [ ] **Step 1: Read the existing per-tenant migration runner pattern**

```bash
cat backend/db/migrations/index.js
cat backend/db/migrations/add_independent_practitioner_support.sql
```

Confirm the exact shape of a migration file in this list (each is a `.sql` file applied idempotently to every tenant on boot) before writing the new one, so Step 3 matches the established convention exactly (e.g. whether files use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or a different idempotency guard).

- [ ] **Step 2: Add the platform DB changes to platform-schema.sql**

In `backend/db/platform-schema.sql`, after the `companies` table definition (ends at line 41, per current reading), add:

```sql
-- Set once at signup confirmation when a valid ?ref=<slug> referral link was
-- used (see independentSignupController.js's confirmIndependentSignup) —
-- the company that referred this one. Never set for tenant-company signups.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS referred_by_company_id uuid REFERENCES companies(id);
```

After the `promo_code_redemptions` table definition (ends at line 107, per current reading), add:

```sql
-- One row per successful referral. referred_second_payment_at and
-- referrer_rewarded_at both start NULL and are set together, once, by the
-- Stripe webhook handler the first time the referred company's SECOND
-- invoice is paid via a real (non-waived) charge — see subscriptionController.js's
-- stripeWebhook. The UNIQUE constraint on referred_company_id is the
-- idempotency guard against Stripe's at-least-once webhook delivery
-- double-granting a reward.
CREATE TABLE IF NOT EXISTS referral_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_company_id uuid NOT NULL REFERENCES companies(id),
  referred_company_id uuid NOT NULL REFERENCES companies(id),
  referred_display_name text NOT NULL,
  referred_first_waived_at timestamptz NOT NULL DEFAULT now(),
  referred_second_payment_at timestamptz,
  referrer_rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_redemptions_referred_unique UNIQUE (referred_company_id)
);
CREATE INDEX IF NOT EXISTS referral_redemptions_referrer_idx ON referral_redemptions (referrer_company_id);
```

- [ ] **Step 3: Write the platform DB migration (applied once, by hand, like platform-schema.sql changes always are)**

Create `backend/db/add_referral_program_platform.sql` (same naming convention as the existing one-off `backend/db/add_independent_practitioners.sql` and `backend/db/add_promo_codes.sql` — standalone files applied directly to `izaya_platform`, not through the per-tenant runner):

```sql
-- Apply once with: psql "<connection string, connected to izaya_platform>" -f backend/db/add_referral_program_platform.sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS referred_by_company_id uuid REFERENCES companies(id);

CREATE TABLE IF NOT EXISTS referral_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_company_id uuid NOT NULL REFERENCES companies(id),
  referred_company_id uuid NOT NULL REFERENCES companies(id),
  referred_display_name text NOT NULL,
  referred_first_waived_at timestamptz NOT NULL DEFAULT now(),
  referred_second_payment_at timestamptz,
  referrer_rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_redemptions_referred_unique UNIQUE (referred_company_id)
);
CREATE INDEX IF NOT EXISTS referral_redemptions_referrer_idx ON referral_redemptions (referrer_company_id);
```

- [ ] **Step 4: Write the per-tenant migration**

Create `backend/db/migrations/add_referral_program.sql`, matching the exact idempotency-guard style confirmed in Step 1:

```sql
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS free_months_owed integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS waived_by_referral boolean NOT NULL DEFAULT false;
```

- [ ] **Step 5: Register the new per-tenant migration**

In `backend/db/migrations/index.js`, append `'add_referral_program.sql'` to the `MIGRATIONS` array (matching the exact pattern every prior entry uses — read the file first to confirm array vs. object shape).

- [ ] **Step 6: Verify the per-tenant migration applies cleanly on a local/staging tenant boot**

```bash
cd backend && npm run dev
```

Watch the startup log for `Migration applied to <tenant>: add_referral_program.sql` on at least one existing tenant database (or confirm via the project's existing migration-verification process — check `backend/db/migrations/index.js`'s own comments for how this is normally verified, since this plan should not invent a new verification method).

- [ ] **Step 7: Commit**

```bash
git add backend/db/platform-schema.sql backend/db/add_referral_program_platform.sql backend/db/migrations/add_referral_program.sql backend/db/migrations/index.js
git commit -m "Add referral program data model (platform DB + per-tenant columns)"
```

**Do not run `add_referral_program_platform.sql` against the real platform DB yet** — deferred to Task 10 alongside the retroactive price script, so both one-off production SQL changes happen together after full review.

---

### Task 3: Capture `?ref=` through signup (frontend + backend)

**Files:**
- Modify: `frontend/src/pages/marketing/Practitioners.jsx`
- Modify: `frontend/src/pages/IndependentSignupWizard.jsx`
- Modify: `backend/db/migrations/add_referral_program.sql` is per-tenant — `pending_signups` is platform DB, so add a separate line to `backend/db/add_referral_program_platform.sql` from Task 2
- Modify: `backend/src/controllers/independentSignupController.js`
- Test: `backend/src/controllers/__tests__/independentSignupController.test.js` (create if it doesn't exist — check first)

**Interfaces:**
- Consumes: `companies.referred_by_company_id`, `referral_redemptions` table (Task 2).
- Produces: `pending_signups.referred_by_code` (text, nullable) and `companies.referred_by_company_id` populated at confirm time; `company_settings.free_months_owed = 1` pre-loaded on a referred tenant's own database immediately at provisioning.

- [ ] **Step 1: Add the pending_signups column to the platform migration file**

In `backend/db/add_referral_program_platform.sql` (from Task 2), add:

```sql
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS referred_by_code text;
```

- [ ] **Step 2: Capture `?ref=` on the marketing page and forward it to signup links**

Read `frontend/src/pages/marketing/Practitioners.jsx` in full first (already read earlier in this session — it imports `Link` from `react-router-dom` and has sign-up CTAs linking to `/signup/independent`). Add near the top of the component function:

```jsx
import { useSearchParams } from 'react-router-dom';
```

Inside `export default function Practitioners() {`, as the first line of the function body:

```jsx
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');
  const signupHref = refCode ? `/signup/independent?ref=${encodeURIComponent(refCode)}` : '/signup/independent';
```

Replace every `<Link to="/signup/independent" ...>` in this file with `<Link to={signupHref} ...>` (there are two: the hero CTA and the final CTA band, per the file read earlier in this session).

- [ ] **Step 3: Capture `?ref=` in the signup wizard and send it with the payload**

Read `frontend/src/pages/IndependentSignupWizard.jsx` in full (872 lines, per prior research) before editing, to find the exact `useState` initialization for `form` (line ~265) and the exact `handleSubmit` POST call (lines ~423-460).

Add near the top of the file:

```jsx
import { useSearchParams } from 'react-router-dom';
```

Inside the component, near the existing `form` state declaration, add:

```jsx
  const [searchParams] = useSearchParams();
  const referredByCode = React.useMemo(() => searchParams.get('ref') || null, [searchParams]);
```

In the `handleSubmit` function, find the request body object being POSTed to `/api/independent-signup` and add `referredByCode` as a field in that object (e.g. `{ ...existingFields, referredByCode }`).

On the step-7 success screen (lines ~776-818 per prior research), find the JSX that renders after a successful signup and add, conditionally:

```jsx
{referredByCode && (
  <p className="text-sm text-emerald-700 mt-2">Your first month is free, thanks to your referral.</p>
)}
```

(Match this `<p>`'s className to whatever styling convention the surrounding success-screen JSX already uses — read that block first and adjust the className to match, don't introduce a new ad-hoc style.)

- [ ] **Step 4: Check for an existing controller test file**

```bash
ls backend/src/controllers/__tests__/independentSignupController.test.js 2>/dev/null || echo "does not exist"
```

- [ ] **Step 5: Write the failing test for referral code validation in requestIndependentSignup**

If creating the test file fresh, mirror whatever mocking convention Task 1's `subscriptionBilling.test.js` used for `pool`/`platformPool` (check that file once written). Add:

```js
const { requestIndependentSignup } = require('../independentSignupController');

jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
const { platformPool } = require('../../config/platformDb');
jest.mock('../../utils/emailClient', () => ({ sendIndependentSignupConfirmationEmail: jest.fn() }));

function mockReqRes(body) {
  const req = { body };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { req, res };
}

describe('requestIndependentSignup referral handling', () => {
  afterEach(() => jest.clearAllMocks());

  it('stores a valid referral code on the pending_signups row', async () => {
    const validBody = {
      slug: 'jsmith', firstName: 'Jamie', lastName: 'Smith', email: 'jamie@example.com',
      password: 'Abcd1234!', disciplines: ['OT'], payRate: 50,
      addressLine1: '1 Main St', addressCity: 'Trenton', addressState: 'NJ', addressZip: '08608',
      address: '1 Main St, Trenton, NJ 08608',
      baaAccepted: true, baaAcceptedByName: 'Jamie Smith', baaAcceptedByEmail: 'jamie@example.com',
      referredByCode: 'referrer-slug',
    };
    // slug availability check
    platformPool.query.mockResolvedValueOnce({ rows: [] });
    // email-exists check
    platformPool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT INTO pending_signups
    platformPool.query.mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes(validBody);
    await requestIndependentSignup(req, res);

    const insertCall = platformPool.query.mock.calls.find((call) => call[0].includes('INSERT INTO pending_signups'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('referrer-slug');
    expect(res.status).toHaveBeenCalledWith(202);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd backend && npx jest src/controllers/__tests__/independentSignupController.test.js
```

Expected: FAIL — `referredByCode` isn't read from `req.body` or inserted anywhere yet.

- [ ] **Step 7: Update requestIndependentSignup to capture and store the referral code**

In `backend/src/controllers/independentSignupController.js`, inside `requestIndependentSignup` (starts at line 135), after the existing email-duplicate check block (ends around line 158) and before building `fullName`, add:

```js
    const referredByCode = req.body.referredByCode ? String(req.body.referredByCode).toLowerCase().trim() : null;
```

In the `INSERT INTO pending_signups` statement (lines 179-207), add `referred_by_code` to the column list and `$21` (adjusting the numbered placeholder to whatever the next free number is after the existing columns — re-read the statement's current column count before editing, since this plan's line numbers may shift slightly after Task 3 Step 1-3's edits to other files) and to the `ON CONFLICT DO UPDATE SET` clause (`referred_by_code = EXCLUDED.referred_by_code`), and add `referredByCode` to the parameter array at the matching position.

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd backend && npx jest src/controllers/__tests__/independentSignupController.test.js
```

Expected: PASS.

- [ ] **Step 9: Write the failing test for confirmIndependentSignup's referral resolution**

Add to the same test file:

```js
const { confirmIndependentSignup } = require('../independentSignupController');
jest.mock('../../config/provisioningDb', () => ({ getProvisioningPool: jest.fn() }));
jest.mock('../../config/tenantPoolRegistry', () => ({ evictTenantPool: jest.fn() }));
jest.mock('../../utils/tenantProvisioning', () => ({
  provisionTenantDatabase: jest.fn().mockResolvedValue({
    tenantPool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
    adminRoleId: 1,
  }),
}));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));

describe('confirmIndependentSignup referral resolution', () => {
  afterEach(() => jest.clearAllMocks());

  it('sets referred_by_company_id and pre-loads free_months_owed=1 when referred_by_code resolves', async () => {
    const pending = {
      slug: 'new-practitioner', display_name: 'New Person', email: 'new@example.com',
      confirm_token_hash: 'hash', confirm_token_expires: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      account_type: 'independent', ceo_first_name: 'New', ceo_last_name: 'Person',
      ceo_email: 'new@example.com', ceo_password_hash: 'hashed', pay_rate: 50,
      address: '1 St', disciplines: ['OT'], address_line1: '1 St', address_city: 'Trenton',
      address_state: 'NJ', address_zip: '08608', baa_accepted_at: new Date().toISOString(),
      baa_accepted_by_name: 'New Person', baa_accepted_by_email: 'new@example.com',
      referred_by_code: 'referrer-slug', custom_dropdown_options: null, removed_default_options: null,
    };
    platformPool.query
      .mockResolvedValueOnce({ rows: [pending] })       // lookup by token
      .mockResolvedValueOnce({ rows: [] })               // existing company by slug check
      .mockResolvedValueOnce({ rows: [{ id: 'referrer-uuid' }] }) // resolve referred_by_code -> companies.id
      .mockResolvedValueOnce({ rows: [] })               // INSERT INTO companies
      .mockResolvedValueOnce({ rows: [] })               // INSERT INTO referral_redemptions
      .mockResolvedValueOnce({ rows: [] });               // DELETE FROM pending_signups

    const { provisionTenantDatabase } = require('../../utils/tenantProvisioning');
    const tenantQueryMock = jest.fn().mockResolvedValue({ rows: [] });
    provisionTenantDatabase.mockResolvedValue({ tenantPool: { query: tenantQueryMock }, adminRoleId: 1 });

    const { req, res } = mockReqRes({});
    req.params = { token: 'raw-token' };
    await confirmIndependentSignup(req, res);

    const freeMonthsCall = tenantQueryMock.mock.calls.find((call) => call[0].includes('free_months_owed'));
    expect(freeMonthsCall).toBeDefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

```bash
cd backend && npx jest src/controllers/__tests__/independentSignupController.test.js -t "referred_by_company_id"
```

Expected: FAIL — no referral resolution logic exists yet in `confirmIndependentSignup`.

- [ ] **Step 11: Implement referral resolution in confirmIndependentSignup**

In `backend/src/controllers/independentSignupController.js`, inside `confirmIndependentSignup` (starts at line 230), after the existing-company slug check (ends around line 250) and before the `tenantDbName` assignment, add:

```js
    let referrerCompanyId = null;
    if (pending.referred_by_code && pending.referred_by_code !== pending.slug) {
      const { rows: referrerRows } = await platformPool.query(
        `SELECT id FROM companies WHERE slug = $1 AND account_type = 'independent' AND status != 'cancelled'`,
        [pending.referred_by_code]
      );
      referrerCompanyId = referrerRows[0]?.id || null;
    }
```

(The `pending.referred_by_code !== pending.slug` check is the self-referral guard from Review Focus item 3 — a practitioner cannot use their own slug as their own referral code.)

After the existing `INSERT INTO company_settings` block (ends around line 271), add:

```js
    if (referrerCompanyId) {
      await tenantPool.query(
        `UPDATE company_settings SET free_months_owed = free_months_owed + 1 WHERE id = 1`
      );
    }
```

In the `INSERT INTO companies` statement (lines 325-334), add `referred_by_company_id` to the column list and parameter array (value: `referrerCompanyId`).

After that `INSERT INTO companies` call and before `DELETE FROM pending_signups`, add:

```js
    if (referrerCompanyId) {
      const { rows: newCompanyRows } = await platformPool.query('SELECT id FROM companies WHERE slug = $1', [pending.slug]);
      const newCompanyId = newCompanyRows[0]?.id;
      if (newCompanyId) {
        await platformPool.query(
          `INSERT INTO referral_redemptions (referrer_company_id, referred_company_id, referred_display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (referred_company_id) DO NOTHING`,
          [referrerCompanyId, newCompanyId, pending.display_name]
        );
      }
    }
```

- [ ] **Step 12: Run the tests to verify they pass**

```bash
cd backend && npx jest src/controllers/__tests__/independentSignupController.test.js
```

Expected: PASS (all tests in the file).

- [ ] **Step 13: Write and run the self-referral guard regression test (Review Focus item 3)**

Add to the same test file:

```js
  it('ignores a referral code that matches the signer\'s own slug (self-referral)', async () => {
    const pending = {
      slug: 'jsmith', display_name: 'Jamie Smith', email: 'jamie@example.com',
      confirm_token_hash: 'hash', confirm_token_expires: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      account_type: 'independent', ceo_first_name: 'Jamie', ceo_last_name: 'Smith',
      ceo_email: 'jamie@example.com', ceo_password_hash: 'hashed', pay_rate: 50,
      address: '1 St', disciplines: ['OT'], address_line1: '1 St', address_city: 'Trenton',
      address_state: 'NJ', address_zip: '08608', baa_accepted_at: new Date().toISOString(),
      baa_accepted_by_name: 'Jamie Smith', baa_accepted_by_email: 'jamie@example.com',
      referred_by_code: 'jsmith', // same as pending.slug — self-referral
      custom_dropdown_options: null, removed_default_options: null,
    };
    platformPool.query
      .mockResolvedValueOnce({ rows: [pending] }) // lookup by token
      .mockResolvedValueOnce({ rows: [] })         // existing company by slug check
      .mockResolvedValueOnce({ rows: [] })         // INSERT INTO companies
      .mockResolvedValueOnce({ rows: [] });         // DELETE FROM pending_signups

    const { provisionTenantDatabase } = require('../../utils/tenantProvisioning');
    const tenantQueryMock = jest.fn().mockResolvedValue({ rows: [] });
    provisionTenantDatabase.mockResolvedValue({ tenantPool: { query: tenantQueryMock }, adminRoleId: 1 });

    const { req, res } = mockReqRes({});
    req.params = { token: 'raw-token' };
    await confirmIndependentSignup(req, res);

    // No referrer lookup query should have been issued at all (self-referral
    // is caught before the SELECT companies WHERE slug = referred_by_code
    // ever runs), and no free_months_owed write should happen.
    const referrerLookup = platformPool.query.mock.calls.find((call) =>
      call[0].includes("account_type = 'independent'") && call[0].includes('status != ')
    );
    expect(referrerLookup).toBeUndefined();
    const freeMonthsCall = tenantQueryMock.mock.calls.find((call) => call[0].includes('free_months_owed'));
    expect(freeMonthsCall).toBeUndefined();
  });
```

```bash
cd backend && npx jest src/controllers/__tests__/independentSignupController.test.js -t "self-referral"
```

Expected: PASS.

- [ ] **Step 14: Write and run the invalid-referral-code regression test (Review Focus item 1)**

Add to the same test file:

```js
  it('signs up successfully even when referred_by_code does not resolve to any real company', async () => {
    const pending = {
      slug: 'new-practitioner', display_name: 'New Person', email: 'new@example.com',
      confirm_token_hash: 'hash', confirm_token_expires: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      account_type: 'independent', ceo_first_name: 'New', ceo_last_name: 'Person',
      ceo_email: 'new@example.com', ceo_password_hash: 'hashed', pay_rate: 50,
      address: '1 St', disciplines: ['OT'], address_line1: '1 St', address_city: 'Trenton',
      address_state: 'NJ', address_zip: '08608', baa_accepted_at: new Date().toISOString(),
      baa_accepted_by_name: 'New Person', baa_accepted_by_email: 'new@example.com',
      referred_by_code: 'nonexistent-slug-xyz', custom_dropdown_options: null, removed_default_options: null,
    };
    platformPool.query
      .mockResolvedValueOnce({ rows: [pending] }) // lookup by token
      .mockResolvedValueOnce({ rows: [] })         // existing company by slug check
      .mockResolvedValueOnce({ rows: [] })         // SELECT companies WHERE slug = referred_by_code -> no match
      .mockResolvedValueOnce({ rows: [] })         // INSERT INTO companies
      .mockResolvedValueOnce({ rows: [] });         // DELETE FROM pending_signups

    const { provisionTenantDatabase } = require('../../utils/tenantProvisioning');
    const tenantQueryMock = jest.fn().mockResolvedValue({ rows: [] });
    provisionTenantDatabase.mockResolvedValue({ tenantPool: { query: tenantQueryMock }, adminRoleId: 1 });

    const { req, res } = mockReqRes({});
    req.params = { token: 'raw-token' };
    await confirmIndependentSignup(req, res);

    // Signup still succeeds — a bad/unknown ref code is silently ignored,
    // never a 400/500.
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const freeMonthsCall = tenantQueryMock.mock.calls.find((call) => call[0].includes('free_months_owed'));
    expect(freeMonthsCall).toBeUndefined();
  });
```

```bash
cd backend && npx jest src/controllers/__tests__/independentSignupController.test.js -t "does not resolve"
```

Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add frontend/src/pages/marketing/Practitioners.jsx frontend/src/pages/IndependentSignupWizard.jsx backend/db/add_referral_program_platform.sql backend/src/controllers/independentSignupController.js backend/src/controllers/__tests__/independentSignupController.test.js
git commit -m "Capture referral codes through signup and pre-load the referred practitioner's free first month"
```

---

### Task 4: Billing integration — consume free-month credits before charging

**Files:**
- Modify: `backend/src/controllers/subscriptionController.js:279-311` (inside `closePeriodInvoice`)
- Test: `backend/src/controllers/__tests__/subscriptionController.test.js` (create if it doesn't exist — check first)

**Interfaces:**
- Consumes: `company_settings.free_months_owed`, `subscription_invoices.waived_by_referral` (Task 2).
- Produces: `closePeriodInvoice` now waives an invoice (no Stripe call) when `free_months_owed > 0`, decrementing the counter by exactly 1 per cycle.

- [ ] **Step 1: Check for an existing subscriptionController test file**

```bash
ls backend/src/controllers/__tests__/subscriptionController.test.js 2>/dev/null || echo "does not exist"
```

- [ ] **Step 2: Write the failing test for credit consumption**

```js
const { closePeriodInvoice } = require('../subscriptionController');
// closePeriodInvoice is not currently exported — Step 4 below also adds it
// to module.exports for testability, since it's presently only called
// internally by generateInvoice/runScheduledBilling in the same file.

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/stripe', () => ({
  getStripeClient: jest.fn(() => ({ paymentIntents: { create: jest.fn() } })),
  isStripeConfigured: jest.fn(() => true),
}));
const { pool } = require('../../config/db');
const { getStripeClient } = require('../../config/stripe');

describe('closePeriodInvoice free-month credit', () => {
  afterEach(() => jest.clearAllMocks());

  it('waives the invoice and skips Stripe when free_months_owed > 0', async () => {
    // no existing invoice for this period
    pool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT ... RETURNING * (pending invoice row)
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, total_amount: '19.99', status: 'pending' }] });
    // SELECT free_months_owed
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 1 }] });
    // UPDATE subscription_invoices SET status='paid', waived_by_referral=true ... RETURNING *
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, total_amount: '19.99', status: 'paid', waived_by_referral: true }] });
    // UPDATE company_settings SET free_months_owed = free_months_owed - 1
    pool.query.mockResolvedValueOnce({ rows: [] });

    const invoice = await closePeriodInvoice('2026-10-01', '2026-10-31', 'independent');

    expect(invoice.status).toBe('paid');
    expect(invoice.waived_by_referral).toBe(true);
    expect(getStripeClient().paymentIntents.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx jest src/controllers/__tests__/subscriptionController.test.js
```

Expected: FAIL — `closePeriodInvoice` isn't exported yet, and the credit-check branch doesn't exist.

- [ ] **Step 4: Export closePeriodInvoice for testability**

In `backend/src/controllers/subscriptionController.js`, find the `module.exports = {` block (starts at line 700, per prior reading) and add `closePeriodInvoice,` to it.

- [ ] **Step 5: Add the credit-check branch in closePeriodInvoice**

In `backend/src/controllers/subscriptionController.js`, the existing code at lines 279-311 reads:

```js
  let invoice = rows[0];

  const stripe = getStripeClient();
  const settings = isIndependent ? await getFlatSubscriptionSettings() : await getSubscriptionSettings();
  if (stripe && settings.stripeCustomerId && settings.defaultPaymentMethodId && Number(invoice.total_amount) > 0) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
```

Replace it with:

```js
  let invoice = rows[0];

  // Free-month referral credits (independent practitioners only — see
  // docs/superpowers/specs/2026-10-11-referral-program-and-price-change-design.md)
  // always take priority over a charge attempt, even with autopay active.
  // Checked before Stripe is touched at all, so a credited period never
  // generates a real PaymentIntent.
  if (isIndependent) {
    const { rows: creditRows } = await pool.query('SELECT free_months_owed FROM company_settings WHERE id = 1');
    const freeMonthsOwed = Number(creditRows[0]?.free_months_owed || 0);
    if (freeMonthsOwed > 0) {
      const { rows: waived } = await pool.query(
        `UPDATE subscription_invoices SET status = 'paid', waived_by_referral = true, paid_at = now() WHERE id = $1 RETURNING *`,
        [invoice.id]
      );
      await pool.query('UPDATE company_settings SET free_months_owed = free_months_owed - 1 WHERE id = 1');
      return waived[0];
    }
  }

  const stripe = getStripeClient();
  const settings = isIndependent ? await getFlatSubscriptionSettings() : await getSubscriptionSettings();
  if (stripe && settings.stripeCustomerId && settings.defaultPaymentMethodId && Number(invoice.total_amount) > 0) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
```

(The rest of the function, from `amount: Math.round(...)` through the closing `return invoice;`, is unchanged.)

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd backend && npx jest src/controllers/__tests__/subscriptionController.test.js
```

Expected: PASS.

- [ ] **Step 7: Write and run the "exactly one credit consumed per cycle" regression test (Review Focus item 4)**

Add to the same test file:

```js
  it('consumes exactly one credit even when free_months_owed is 2', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, total_amount: '19.99', status: 'pending' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 2 }] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, total_amount: '19.99', status: 'paid', waived_by_referral: true }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    await closePeriodInvoice('2026-10-01', '2026-10-31', 'independent');

    const decrementCall = pool.query.mock.calls.find((call) => call[0].includes('free_months_owed = free_months_owed - 1'));
    expect(decrementCall).toBeDefined();
    // The decrement is a relative SQL expression (- 1), not a literal
    // "- 2" anywhere in the call, which is what guarantees only one
    // credit is spent regardless of the starting balance.
    expect(decrementCall[0]).not.toContain('- 2');
  });
```

```bash
cd backend && npx jest src/controllers/__tests__/subscriptionController.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/subscriptionController.js backend/src/controllers/__tests__/subscriptionController.test.js
git commit -m "Consume free-month referral credits before attempting a Stripe charge"
```

---

### Task 5: Webhook — grant the referrer's reward on the referred practitioner's 2nd paid invoice

**Files:**
- Modify: `backend/src/controllers/subscriptionController.js:593-612` (inside `stripeWebhook`)
- Modify: `backend/src/utils/emailClient.js` (two new email functions)
- Modify: `backend/src/utils/notifications.js` (new file — see Task 6, but the writer function is needed here; if Task 6 hasn't been done yet, create a minimal version now and Task 6 will build on it)
- Test: `backend/src/controllers/__tests__/subscriptionController.test.js`

**Interfaces:**
- Consumes: `referral_redemptions` (Task 2), `platformPool` (resolving tenant → platform company id).
- Produces: on the referred tenant's 2nd real paid invoice, increments the referrer's own tenant `company_settings.free_months_owed` by 1, sets `referral_redemptions.referred_second_payment_at`/`referrer_rewarded_at`, sends both notification emails, and writes a `notifications` row for both practitioners.

- [ ] **Step 1: Create the shared notification-writer helper (minimal version)**

Create `backend/src/utils/notifications.js`:

```js
const { pool } = require('../config/db');

// Writes one row into the current tenant's own `notifications` table (see
// add_referral_program.sql / Task 2 and Task 6) — always called from
// inside a runWithTenant(...) context, same as every other per-tenant
// write in this codebase. Independent-practitioner-only feature; never
// called for a tenant-company practitioner's tenant database.
async function writeNotification({ type, title, body }) {
  await pool.query(
    `INSERT INTO notifications (type, title, body) VALUES ($1, $2, $3)`,
    [type, title, body]
  );
}

module.exports = { writeNotification };
```

- [ ] **Step 2: Write the failing test for the referrer-reward webhook branch**

Add to `backend/src/controllers/__tests__/subscriptionController.test.js`:

```js
const { stripeWebhook } = require('../subscriptionController');
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantContext', () => ({
  runWithTenant: jest.fn((db, fn) => fn()),
  getCurrentTenantDb: jest.fn(),
}));
jest.mock('../../utils/notifications', () => ({ writeNotification: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({
  sendReferralRewardEarnedEmail: jest.fn(),
  sendReferralFirstMonthFreeEmail: jest.fn(),
}));
const { platformPool } = require('../../config/platformDb');
const { writeNotification } = require('../../utils/notifications');
const { sendReferralRewardEarnedEmail } = require('../../utils/emailClient');

describe('stripeWebhook referrer reward', () => {
  afterEach(() => jest.clearAllMocks());

  it('grants the referrer a free month on the referred practitioner\'s 2nd real paid invoice', async () => {
    const stripe = {
      webhooks: { constructEvent: jest.fn(() => ({
        type: 'payment_intent.succeeded',
        data: { object: { customer: 'cus_referred', id: 'pi_123', last_payment_error: null } },
      })) },
    };
    getStripeClient.mockReturnValue(stripe);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    platformPool.query
      .mockResolvedValueOnce({ rows: [{ tenant_db_name: 'tenant_referred', id: 'referred-uuid' }] }) // resolve tenant by stripe customer
      .mockResolvedValueOnce({ rows: [{ referrer_company_id: 'referrer-uuid', referrer_rewarded_at: null }] }) // referral_redemptions lookup
      .mockResolvedValueOnce({ rows: [{ tenant_db_name: 'tenant_referrer' }] }) // resolve referrer's tenant_db_name
      .mockResolvedValueOnce({ rows: [] }); // UPDATE referral_redemptions

    pool.query
      .mockResolvedValueOnce({ rows: [] }) // UPDATE subscription_invoices status
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // COUNT paid non-waived invoices for this tenant -> this IS the 2nd
      .mockResolvedValueOnce({ rows: [] }); // UPDATE company_settings free_months_owed +1 (runs inside runWithTenant for referrer)

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
    await stripeWebhook(req, res);

    expect(writeNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'referral_reward_earned' }));
    expect(sendReferralRewardEarnedEmail).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});
```

Import `getStripeClient` and `pool` at the top of the test file the same way Task 4's tests already do (they're in the same file).

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx jest src/controllers/__tests__/subscriptionController.test.js -t "referrer a free month"
```

Expected: FAIL — no referral-reward logic exists in the webhook yet.

- [ ] **Step 4: Implement the referrer-reward branch in stripeWebhook**

In `backend/src/controllers/subscriptionController.js`, the existing code inside `runWithTenant(tenantDbName, async () => { ... })` (lines 593-612) reads:

```js
    await runWithTenant(tenantDbName, async () => {
      if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
        const intent = event.data.object;
        const status = event.type === 'payment_intent.succeeded' ? 'paid' : 'failed';
        await pool.query(
          `UPDATE subscription_invoices SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE paid_at END,
             failure_reason = CASE WHEN $1 = 'failed' THEN $2 ELSE failure_reason END
           WHERE stripe_payment_intent_id = $3`,
          [status, intent.last_payment_error?.message || null, intent.id]
        );
      } else {
```

Add, immediately after that `UPDATE subscription_invoices` call and still inside the `runWithTenant` callback, before the `} else {`:

```js
        if (status === 'paid') {
          await maybeRewardReferrer(tenantDbName);
        }
```

Add a new function above `stripeWebhook` (so it's defined before use — place it directly before the `const stripeWebhook = async (req, res) => {` line):

```js
const { writeNotification } = require('../utils/notifications');
const { sendReferralRewardEarnedEmail } = require('../utils/emailClient');

// Called from inside the webhook's runWithTenant(tenantDbName, ...) context
// for the tenant whose invoice JUST got marked 'paid' via a real Stripe
// charge (never called for a waived invoice — see closePeriodInvoice,
// which returns early for a waived one without ever creating a PaymentIntent,
// so this webhook branch is never reached for a waived invoice at all).
// Grants the REFERRER (not this tenant) a free month once this is this
// tenant's 2nd-ever paid, non-waived invoice.
async function maybeRewardReferrer(referredTenantDbName) {
  const { rows: referredCompanyRows } = await platformPool.query(
    'SELECT id FROM companies WHERE tenant_db_name = $1',
    [referredTenantDbName]
  );
  const referredCompanyId = referredCompanyRows[0]?.id;
  if (!referredCompanyId) return;

  const { rows: redemptionRows } = await platformPool.query(
    'SELECT referrer_company_id, referrer_rewarded_at FROM referral_redemptions WHERE referred_company_id = $1',
    [referredCompanyId]
  );
  const redemption = redemptionRows[0];
  if (!redemption || redemption.referrer_rewarded_at) return; // not a referred signup, or already rewarded

  const { rows: paidCountRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM subscription_invoices WHERE status = 'paid' AND waived_by_referral = false`
  );
  const paidNonWaivedCount = Number(paidCountRows[0]?.count || 0);
  if (paidNonWaivedCount !== 2) return; // only fires on exactly the 2nd real paid invoice

  const { rows: referrerCompanyRows } = await platformPool.query(
    'SELECT tenant_db_name, email, display_name FROM companies WHERE id = $1',
    [redemption.referrer_company_id]
  );
  const referrer = referrerCompanyRows[0];
  if (!referrer) return;

  await platformPool.query(
    `UPDATE referral_redemptions SET referred_second_payment_at = now(), referrer_rewarded_at = now() WHERE referred_company_id = $1`,
    [referredCompanyId]
  );

  const { rows: referredCompanyInfo } = await platformPool.query(
    'SELECT display_name FROM companies WHERE id = $1', [referredCompanyId]
  );
  const referredDisplayName = referredCompanyInfo[0]?.display_name || 'Someone you referred';

  await runWithTenant(referrer.tenant_db_name, async () => {
    await pool.query('UPDATE company_settings SET free_months_owed = free_months_owed + 1 WHERE id = 1');
    await writeNotification({
      type: 'referral_reward_earned',
      title: 'You earned a free month',
      body: `${referredDisplayName} just earned you a free month.`,
    });
  });

  try {
    await sendReferralRewardEarnedEmail(referrer.email, referredDisplayName);
  } catch (emailError) {
    console.error('Failed to send referral reward email:', emailError);
  }
}
```

- [ ] **Step 5: Add the two new email functions**

In `backend/src/utils/emailClient.js`, after the existing `sendIndependentSignupConfirmationEmail` function (ends around line 264, per prior reading), add:

```js
// Sent to the REFERRED practitioner at signup confirmation, when they
// signed up via a valid ?ref= link — a fork of
// sendIndependentSignupConfirmationEmail's wording convention (see the
// comment on that function), not a shared/parameterized template.
const sendReferralFirstMonthFreeEmail = async (toEmail, referrerName) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping referral first-month-free email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;">Your first month is free, thanks to <b style="color:${COLORS.navy};">${referrerName}</b>. No charge for your first billing cycle — your card is only charged starting your second month.</p>
  `;
  const html = emailShell({
    preheader: `Your first month on Izaya One is on us.`,
    eyebrow: 'Referral applied',
    heading: 'Your first month is free',
    bodyHtml,
    logoUrl: IZAYA_ONE_LOGO_URL,
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'Your first month on Izaya One is free',
    html,
  });
};

// Sent to the REFERRER once their reward vests (the referred practitioner's
// 2nd real paid invoice) — see maybeRewardReferrer in subscriptionController.js.
const sendReferralRewardEarnedEmail = async (toEmail, referredName) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping referral reward-earned email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;"><b style="color:${COLORS.navy};">${referredName}</b>'s second payment just went through — you've earned a free month on Izaya One. It'll apply automatically to your next bill.</p>
  `;
  const html = emailShell({
    preheader: `You've earned a free month on Izaya One.`,
    eyebrow: 'Referral reward',
    heading: 'You earned a free month',
    bodyHtml,
    logoUrl: IZAYA_ONE_LOGO_URL,
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'You earned a free month on Izaya One',
    html,
  });
};
```

Add both new function names to the `module.exports` block at the bottom of the file (next to `sendIndependentSignupConfirmationEmail`, per line 484 of prior reading).

- [ ] **Step 6: Wire the first-month-free email and notification into confirmIndependentSignup**

In `backend/src/controllers/independentSignupController.js`, inside the `if (referrerCompanyId) { ... }` block added in Task 3 Step 11 (the one that updates `free_months_owed`), add after the `UPDATE company_settings` call:

```js
      const { writeNotification } = require('../utils/notifications');
      await writeNotification({
        type: 'referral_first_month_free',
        title: 'Your first month is free',
        body: 'Your first month is free, thanks to your referral.',
      });
```

After the whole provisioning try block succeeds (immediately before the final `res.json({ success: true, ... })` at the end of `confirmIndependentSignup`), add:

```js
    if (referrerCompanyId) {
      const { rows: referrerRows } = await platformPool.query('SELECT email, display_name FROM companies WHERE id = $1', [referrerCompanyId]);
      if (referrerRows[0]) {
        try {
          const { sendReferralFirstMonthFreeEmail } = require('../utils/emailClient');
          await sendReferralFirstMonthFreeEmail(pending.ceo_email, referrerRows[0].display_name);
        } catch (emailError) {
          console.error('Failed to send referral first-month-free email:', emailError);
        }
      }
    }
```

(Requiring `emailClient`/`notifications` inline here rather than at the top of the file matches this file's existing style of importing `sendIndependentSignupConfirmationEmail` at the top — for consistency, move both `require` calls to the top of the file alongside the existing `sendIndependentSignupConfirmationEmail` import instead of inlining them, i.e. change the existing top-of-file line to `const { sendIndependentSignupConfirmationEmail, sendReferralFirstMonthFreeEmail } = require('../utils/emailClient');` and add `const { writeNotification } = require('../utils/notifications');` alongside the other top-of-file requires, then remove the inline `require(...)` calls shown above.)

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd backend && npx jest src/controllers/__tests__/subscriptionController.test.js src/controllers/__tests__/independentSignupController.test.js
```

Expected: PASS (all tests across both files).

- [ ] **Step 8: Write and run the idempotency regression test (Review Focus item 2)**

Add to `backend/src/controllers/__tests__/subscriptionController.test.js`:

```js
  it('does not double-grant a reward if the webhook fires twice for the same event', async () => {
    const stripe = { webhooks: { constructEvent: jest.fn(() => ({
      type: 'payment_intent.succeeded',
      data: { object: { customer: 'cus_referred', id: 'pi_123', last_payment_error: null } },
    })) } };
    getStripeClient.mockReturnValue(stripe);

    platformPool.query
      .mockResolvedValueOnce({ rows: [{ tenant_db_name: 'tenant_referred', id: 'referred-uuid' }] })
      .mockResolvedValueOnce({ rows: [{ referrer_company_id: 'referrer-uuid', referrer_rewarded_at: '2026-10-01T00:00:00Z' }] }); // already rewarded

    pool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE subscription_invoices status

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
    await stripeWebhook(req, res);

    expect(writeNotification).not.toHaveBeenCalled();
    expect(sendReferralRewardEarnedEmail).not.toHaveBeenCalled();
  });
```

```bash
cd backend && npx jest src/controllers/__tests__/subscriptionController.test.js -t "double-grant"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/controllers/subscriptionController.js backend/src/controllers/independentSignupController.js backend/src/utils/emailClient.js backend/src/utils/notifications.js backend/src/controllers/__tests__/subscriptionController.test.js backend/src/controllers/__tests__/independentSignupController.test.js
git commit -m "Grant the referrer a free month automatically on the referred practitioner's 2nd paid invoice"
```

---

### Task 6: Notifications table + backend routes + bill-due/payment-failed writers

**Files:**
- Modify: `backend/db/migrations/add_referral_program.sql` (add the `notifications` table — same migration file as Task 2, per-tenant)
- Create: `backend/src/controllers/notificationController.js`
- Create: `backend/src/routes/notificationRoutes.js`
- Modify: `backend/src/app.js` or wherever routes are mounted (check `backend/src/routes/billingRoutes.js`'s own mount point in the main router file first)
- Modify: `backend/src/controllers/subscriptionController.js` (bill-due-soon and payment-failed writers)
- Modify: `backend/src/utils/notifications.js` (from Task 5 — already has `writeNotification`)
- Test: `backend/src/controllers/__tests__/notificationController.test.js`

**Interfaces:**
- Consumes: `writeNotification({ type, title, body })` (Task 5).
- Produces: `GET /api/notifications` → `{ success: true, notifications: [{ id, type, title, body, created_at, read_at }] }`; `POST /api/notifications/:id/read` → `{ success: true }`.

- [ ] **Step 1: Add the notifications table to the per-tenant migration**

In `backend/db/migrations/add_referral_program.sql` (from Task 2), append:

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at DESC);
```

(This is a single migration file applied once per tenant — adding to it after Task 2 already registered it in `index.js` is safe as long as this edit lands before Task 2's migration has actually run against any real database; if Task 2 was already deployed to staging/production before this task, write a SEPARATE new migration file instead, e.g. `add_notifications_table.sql`, and register that one too. Check deployment state before choosing.)

- [ ] **Step 2: Find where other independent-only route files are mounted**

```bash
grep -n "billingRoutes\|require.*billingRoutes\|app.use.*billing" backend/src/app.js backend/index.js 2>/dev/null
```

Read whichever file mounts `billingRoutes` to find the exact mounting pattern (e.g. `app.use('/api/billing', billingRoutes)`) to replicate for the new notification routes.

- [ ] **Step 3: Write the failing test for GET /api/notifications**

Create `backend/src/controllers/__tests__/notificationController.test.js`:

```js
const { listNotifications, markNotificationRead } = require('../notificationController');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');

function mockReqRes(params = {}) {
  const req = { params };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { req, res };
}

describe('notificationController', () => {
  afterEach(() => jest.clearAllMocks());

  it('lists notifications newest first', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, type: 'referral_reward_earned', title: 'T', body: 'B', created_at: '2026-10-02', read_at: null }] });
    const { req, res } = mockReqRes();
    await listNotifications(req, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, notifications: expect.any(Array) });
  });

  it('marks a notification read', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const { req, res } = mockReqRes({ id: '5' });
    await markNotificationRead(req, res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd backend && npx jest src/controllers/__tests__/notificationController.test.js
```

Expected: FAIL — `backend/src/controllers/notificationController.js` doesn't exist.

- [ ] **Step 5: Create the notification controller**

Create `backend/src/controllers/notificationController.js`:

```js
const { pool } = require('../config/db');

// Independent-practitioner-only (see routes/notificationRoutes.js's guard).
const listNotifications = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, body, created_at, read_at FROM notifications ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ success: true, notifications: rows });
  } catch (error) {
    console.error('Error listing notifications:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
};

module.exports = { listNotifications, markNotificationRead };
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd backend && npx jest src/controllers/__tests__/notificationController.test.js
```

Expected: PASS.

- [ ] **Step 7: Create the routes file**

Create `backend/src/routes/notificationRoutes.js`, matching the exact `independentGuard` pattern from `backend/src/routes/billingRoutes.js:68`:

```js
const express = require('express');
const router = express.Router();
const { protect, loadPermissions, requireRole } = require('../middleware/authMiddleware');
const { listNotifications, markNotificationRead } = require('../controllers/notificationController');

const independentGuard = [protect, loadPermissions, requireRole(['independent_practitioner'])];

router.get('/', ...independentGuard, listNotifications);
router.post('/:id/read', ...independentGuard, markNotificationRead);

module.exports = router;
```

- [ ] **Step 8: Mount the new routes**

In whichever file Step 2 identified, add (matching that file's exact mounting style):

```js
const notificationRoutes = require('./routes/notificationRoutes'); // adjust path to match this file's existing require style
app.use('/api/notifications', notificationRoutes);
```

- [ ] **Step 9: Add the bill-due-soon writer to the existing billing cron**

```bash
grep -n "runScheduledBilling" backend/src/controllers/subscriptionController.js
```

Read the function this finds in full. Find where it iterates tenants about to be billed (likely inside the loop that calls `closePeriodInvoice` per tenant via `runWithTenant`). A few days before that loop would run for a given tenant is not tracked today — instead, add the bill-due-soon notification at the point the invoice is first created as `'pending'` (inside `closePeriodInvoice`, right after the `INSERT INTO subscription_invoices ... RETURNING *` call, before the free-month-credit check added in Task 4): if `isIndependent` and the invoice's `total_amount > 0`, write a notification:

```js
  if (isIndependent && Number(invoice.total_amount) > 0) {
    const { writeNotification } = require('../utils/notifications');
    await writeNotification({
      type: 'bill_due_soon',
      title: 'Your bill is ready',
      body: `Your ${periodStart} to ${periodEnd} bill of $${Number(invoice.total_amount).toFixed(2)} will be charged to your card on file.`,
    });
  }
```

(Move this `require` to the top of `subscriptionController.js` alongside the other requires added in Task 5, rather than inlining it here, for the same consistency reason noted in Task 5 Step 6.)

- [ ] **Step 10: Add the payment-failed writer**

In the same function, the existing `catch (chargeError) { ... }` block (lines 300-307, per original reading — now shifted slightly by Task 4's edits) already marks the invoice `'failed'`. Add, inside that catch block, after the `UPDATE subscription_invoices SET status = 'failed'` call:

```js
      if (isIndependent) {
        await writeNotification({
          type: 'payment_failed',
          title: 'Payment failed',
          body: `We couldn't charge your card for your ${periodStart} to ${periodEnd} bill. Please update your payment method.`,
        });
      }
```

- [ ] **Step 11: Run the full backend test suite to check for regressions**

```bash
cd backend && npx jest src/controllers/__tests__/subscriptionController.test.js src/controllers/__tests__/notificationController.test.js src/controllers/__tests__/independentSignupController.test.js
```

Expected: PASS (all tests, no regressions in previously-passing tests).

- [ ] **Step 12: Commit**

```bash
git add backend/db/migrations/add_referral_program.sql backend/src/controllers/notificationController.js backend/src/routes/notificationRoutes.js backend/src/controllers/subscriptionController.js backend/src/controllers/__tests__/notificationController.test.js
git commit -m "Add notifications backend: list/mark-read endpoints, bill-due-soon and payment-failed writers"
```

(Adjust the `git add` for whichever file Step 8 modified to mount the routes.)

---

### Task 7: Referrals backend endpoint

**Files:**
- Create: `backend/src/controllers/referralController.js`
- Create: `backend/src/routes/referralRoutes.js`
- Modify: route-mounting file (same one from Task 6 Step 2)
- Test: `backend/src/controllers/__tests__/referralController.test.js`

**Interfaces:**
- Produces: `GET /api/referrals` → `{ success: true, freeMonthsOwed: number, referrals: [{ referredDisplayName, status: 'invited' | 'rewarded', rewardedAt: string | null }] }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/__tests__/referralController.test.js`:

```js
const { getReferrals } = require('../referralController');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { platformPool } = require('../../config/platformDb');

describe('getReferrals', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns free months owed and the referral list with status', async () => {
    const req = { practitioner: { slug: 'my-slug' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    platformPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'my-company-uuid' }] }) // resolve slug -> companies.id
      .mockResolvedValueOnce({ rows: [
        { referred_display_name: 'Jamie Smith', referrer_rewarded_at: '2026-10-05T00:00:00Z' },
        { referred_display_name: 'Alex Lee', referrer_rewarded_at: null },
      ] }); // referral_redemptions list
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 1 }] });

    await getReferrals(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      freeMonthsOwed: 1,
      referrals: [
        { referredDisplayName: 'Jamie Smith', status: 'rewarded', rewardedAt: '2026-10-05T00:00:00Z' },
        { referredDisplayName: 'Alex Lee', status: 'invited', rewardedAt: null },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx jest src/controllers/__tests__/referralController.test.js
```

Expected: FAIL — `referralController.js` doesn't exist.

- [ ] **Step 3: Create the controller**

Create `backend/src/controllers/referralController.js`:

```js
const { pool } = require('../config/db');
const { platformPool } = require('../config/platformDb');

// The JWT carries `slug` and `tenantDb` (see authController.js's
// jwt.sign call) but not the platform companies.id (a uuid) directly —
// resolved here by slug each call, same cost/pattern as other lookups
// in this codebase that bridge tenant-scoped requests to platform data.
const getReferrals = async (req, res) => {
  try {
    const { rows: companyRows } = await platformPool.query(
      'SELECT id FROM companies WHERE slug = $1', [req.practitioner.slug]
    );
    const companyId = companyRows[0]?.id;
    if (!companyId) return res.json({ success: true, freeMonthsOwed: 0, referrals: [] });

    const [{ rows: redemptions }, { rows: creditRows }] = await Promise.all([
      platformPool.query(
        `SELECT referred_display_name, referrer_rewarded_at
         FROM referral_redemptions WHERE referrer_company_id = $1 ORDER BY created_at DESC`,
        [companyId]
      ),
      pool.query('SELECT free_months_owed FROM company_settings WHERE id = 1'),
    ]);

    res.json({
      success: true,
      freeMonthsOwed: Number(creditRows[0]?.free_months_owed || 0),
      referrals: redemptions.map((r) => ({
        referredDisplayName: r.referred_display_name,
        status: r.referrer_rewarded_at ? 'rewarded' : 'invited',
        rewardedAt: r.referrer_rewarded_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching referrals:', error);
    res.status(500).json({ error: 'Failed to load referrals' });
  }
};

module.exports = { getReferrals };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx jest src/controllers/__tests__/referralController.test.js
```

Expected: PASS.

- [ ] **Step 5: Create the routes file and mount it**

Create `backend/src/routes/referralRoutes.js`:

```js
const express = require('express');
const router = express.Router();
const { protect, loadPermissions, requireRole } = require('../middleware/authMiddleware');
const { getReferrals } = require('../controllers/referralController');

const independentGuard = [protect, loadPermissions, requireRole(['independent_practitioner'])];

router.get('/', ...independentGuard, getReferrals);

module.exports = router;
```

Mount it in the same file from Task 6 Step 2/8:

```js
const referralRoutes = require('./routes/referralRoutes'); // adjust path to match
app.use('/api/referrals', referralRoutes);
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/referralController.js backend/src/routes/referralRoutes.js backend/src/controllers/__tests__/referralController.test.js
git commit -m "Add GET /api/referrals endpoint for the mobile Referral Program screen"
```

(Include the route-mounting file in this commit too.)

---

### Task 8: Mobile — Referral Program screen

**Files:**
- Modify: `mobile/src/types/index.ts` (new `ReferralEntry` / `ReferralSummary` types)
- Create: `mobile/src/pages/ReferralProgram.tsx`
- Modify: `mobile/src/pages/shell/Profile.tsx` (new menu row)
- Modify: `mobile/src/App.tsx` (new route)

**Interfaces:**
- Consumes: `GET /api/referrals` (Task 7).
- Produces: a reachable `/profile/referrals` screen.

- [ ] **Step 1: Add the new types**

In `mobile/src/types/index.ts`, near the existing `FlatSubscriptionSummary` interface (line ~175, per prior reading), add:

```ts
export interface ReferralEntry {
  referredDisplayName: string;
  status: "invited" | "rewarded";
  rewardedAt: string | null;
}

export interface ReferralSummary {
  freeMonthsOwed: number;
  referrals: ReferralEntry[];
}
```

- [ ] **Step 2: Create the Referral Program screen**

Create `mobile/src/pages/ReferralProgram.tsx`, pattern-matched exactly to `mobile/src/pages/MySubscription.tsx`:

```tsx
import * as React from "react";
import { Copy, Share2 } from "lucide-react";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import api from "@/api/axiosInstance";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/toast";
import { formatSafeDate } from "@/utils/time";
import type { ReferralSummary } from "@/types";

const WEB_URL = (import.meta.env.VITE_FRONTEND_URL as string | undefined) || "https://izayaedge.com/eis";

// Independent-practitioner-only, reached from Profile -> Referral program.
// Referral code is the practitioner's own login slug (useAuth().slug) —
// there is no separately generated code (see the referral program spec).
export default function ReferralProgram() {
  const { slug } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = React.useState<ReferralSummary | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const referralLink = `${WEB_URL}/practitioners?ref=${slug}`;

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<ReferralSummary & { success: boolean }>("/api/referrals");
      setData(res.data);
    } catch {
      setError("Couldn't load your referral program.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      showToast("Referral link copied");
    } catch {
      showToast("Couldn't copy the link");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join Izaya One", url: referralLink });
      } catch {
        // user cancelled the share sheet — no action needed
      }
    } else {
      handleCopy();
    }
  };

  return (
    <PushScreen>
      <AppBar title="Referral program" />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {error ? (
          <InlineErrorBanner message={error} onRetry={fetchData} />
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[100px] w-full" />
            <Skeleton className="h-[90px] w-full" />
            <Skeleton className="h-[72px] w-full" />
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
              <p className="text-[13px] font-semibold text-ink-muted">Free months earned</p>
              <p className="tabular mt-1 text-[28px] font-bold text-ink">{data?.freeMonthsOwed ?? 0}</p>
              <p className="mt-1 text-xs text-ink-muted">
                You get a free month once someone you refer pays for their second month.
              </p>
            </div>

            <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
              <p className="text-[13px] font-semibold text-ink-muted">Your referral link</p>
              <p className="mt-1 break-all text-[13px] text-ink">{referralLink}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="press-scale flex flex-1 items-center justify-center gap-1.5 rounded-control border border-border bg-bg py-2 text-sm font-semibold text-ink"
                >
                  <Copy className="size-3.5" aria-hidden="true" /> Copy
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="press-scale flex flex-1 items-center justify-center gap-1.5 rounded-control bg-primary py-2 text-sm font-semibold text-white"
                >
                  <Share2 className="size-3.5" aria-hidden="true" /> Share
                </button>
              </div>
            </div>

            {!data?.referrals.length ? (
              <EmptyState
                heading="No referrals yet"
                subtext="Share your link — your first referral starts earning you a free month once they pay for their second month."
              />
            ) : (
              <ul className="space-y-2">
                {data.referrals.map((r) => (
                  <li
                    key={r.referredDisplayName}
                    className="flex items-center justify-between rounded-card border border-border bg-surface p-3.5 shadow-[var(--elev-rest)]"
                  >
                    <span className="text-[15px] font-medium text-ink">{r.referredDisplayName}</span>
                    {r.status === "rewarded" ? (
                      <span className="text-xs font-semibold text-success">
                        Reward earned {r.rewardedAt ? formatSafeDate(r.rewardedAt) : ""}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-ink-muted">Invited</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PushScreen>
  );
}
```

Before finalizing, check `mobile/src/contexts/AuthContext.tsx` to confirm `slug` is actually exposed by `useAuth()` (the earlier research confirmed `isIndependentPractitioner` is; verify `slug` the same way — grep the file) and that `useToast`'s `showToast` function name matches (`mobile/src/components/ui/toast.tsx`). Adjust the import/usage if either name differs from what's assumed above.

```bash
grep -n "slug" mobile/src/contexts/AuthContext.tsx
grep -n "showToast\|export function useToast\|export const useToast" mobile/src/components/ui/toast.tsx
```

- [ ] **Step 3: Add the route**

In `mobile/src/App.tsx`, near the existing `import MySubscription from "@/pages/MySubscription";` (line 38) add:

```tsx
import ReferralProgram from "@/pages/ReferralProgram";
```

Near the existing `<Route path="/profile/subscription" element={<MySubscription />} />` (line 165), add:

```tsx
                <Route path="/profile/referrals" element={<ReferralProgram />} />
```

- [ ] **Step 4: Add the Profile menu row**

In `mobile/src/pages/shell/Profile.tsx`, add `Users` (or another appropriate icon already available from `lucide-react` — check what's already imported and pick one not yet used, e.g. `Gift` or `Users`) to the existing import line (line 3). After the existing "My subscription" button block (lines 166-176, per prior reading), add:

```tsx
        {isIndependentPractitioner && (
          <button
            type="button"
            onClick={() => navigate("/profile/referrals")}
            className="press-scale flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
          >
            <Gift className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="flex-1 text-[15px] font-medium text-ink">Referral program</span>
            <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
          </button>
        )}
```

- [ ] **Step 5: Manual verification**

```bash
cd mobile && npm run dev
```

Log in as an existing independent practitioner (or create a test one), navigate to Profile → Referral program, confirm the screen loads without error and the referral link contains the practitioner's own slug.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/types/index.ts mobile/src/pages/ReferralProgram.tsx mobile/src/pages/shell/Profile.tsx mobile/src/App.tsx
git commit -m "Add Referral Program screen under Profile for independent practitioners"
```

---

### Task 9: Mobile — Inbox notifications item type

**Files:**
- Modify: `mobile/src/types/index.ts` (new `AppNotification` type)
- Modify: `mobile/src/contexts/AppDataContext.tsx` (new `notifications`/`fetchNotifications` state, matching the `fetchAgencies` conditional-fetch pattern)
- Modify: `mobile/src/pages/shell/Inbox.tsx` (new third item block)
- Modify: `mobile/src/components/shell/ShellLayout.tsx` (fold into the badge count)

**Interfaces:**
- Consumes: `GET /api/notifications`, `POST /api/notifications/:id/read` (Task 6).
- Produces: `AppDataContext`'s `notifications: AppNotification[]`, `fetchNotifications: () => Promise<void>`.

- [ ] **Step 1: Add the AppNotification type**

In `mobile/src/types/index.ts`, near the `RejectedLog` interface (line 251, per prior reading), add:

```ts
export interface AppNotification {
  id: number;
  type: "referral_first_month_free" | "referral_reward_earned" | "bill_due_soon" | "payment_failed";
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}
```

- [ ] **Step 2: Add notifications state to AppDataContext**

In `mobile/src/contexts/AppDataContext.tsx`, near the existing `agencies`/`agenciesLoading` state (search for `useState<Agency[]>` to find it), add:

```ts
  const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = React.useState(true);
```

Add `AppNotification` to the existing type import line that already imports `Agency`, `RejectedLog`, etc.

Near the existing `fetchAgencies` function (line 255, per prior reading), add:

```ts
  const fetchNotifications = React.useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const res = await api.get<{ success: boolean; notifications: AppNotification[] }>("/api/notifications");
      setNotifications(res.data.notifications || []);
    } catch {
      // Non-critical — the Inbox notification section just stays empty until retried.
    } finally {
      setNotificationsLoading(false);
    }
  }, []);
```

In the existing `React.useEffect` block (lines 267-282, per prior reading) that already has `if (isIndependentPractitioner) fetchAgencies();`, add directly below it:

```ts
    if (isIndependentPractitioner) fetchNotifications();
```

Add `fetchNotifications` to that `useEffect`'s dependency array (alongside the existing `fetchAgencies`).

Add `notifications`, `notificationsLoading`, `fetchNotifications` to both places the context value object is built (lines ~319-322 and ~366-369, per prior reading — there are two, likely a memo and a non-memo fallback or similar; read the surrounding code to confirm both need the same three additions) and to the `AppDataContextValue` TypeScript interface near the top of the file (alongside the existing `rejectedLogs`/`fetchRejectedLogs` entries at lines 26-29).

- [ ] **Step 3: Add the third Inbox item block**

In `mobile/src/pages/shell/Inbox.tsx`, add to the imports:

```tsx
import { Bell } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
```

Inside the component, destructure the new context values and the auth flag:

```tsx
  const { isIndependentPractitioner } = useAuth();
```

add `notifications, notificationsLoading, fetchNotifications,` to the existing `useAppData()` destructure (line 14-19, per prior reading).

Update the existing `useEffect` (lines 31-34) to:

```tsx
  React.useEffect(() => {
    fetchRejectedLogs();
    fetchTelepracticeRequests();
    if (isIndependentPractitioner) fetchNotifications();
  }, [fetchRejectedLogs, fetchTelepracticeRequests, fetchNotifications, isIndependentPractitioner]);
```

Update `loading`/`isEmpty` (lines 36-38) to:

```tsx
  const loading = rejectedLoading || telepracticeLoading || (isIndependentPractitioner && notificationsLoading);
  const error = rejectedError || telepracticeError;
  const unreadNotifications = isIndependentPractitioner ? notifications.filter((n) => !n.read_at) : [];
  const isEmpty = rejectedLogs.length === 0 && signedTelepracticeRequests.length === 0 && unreadNotifications.length === 0;
```

Update the empty-state `subtext` (line 64) to account for the independent-practitioner case without changing it for everyone else:

```tsx
          subtext={
            isIndependentPractitioner
              ? "No rejected/declined logs, signed telepractice sessions, or notifications right now."
              : "No rejected/declined logs or signed telepractice sessions right now."
          }
```

Inside the `<ul>` block (after line 67, before the `signedTelepracticeRequests.map(...)` block), add a third rendering block:

```tsx
          {isIndependentPractitioner && unreadNotifications.map((n) => (
            <li key={`notification-${n.id}`}>
              <button
                type="button"
                onClick={async () => {
                  await api.post(`/api/notifications/${n.id}/read`);
                  fetchNotifications();
                }}
                className="press-scale flex w-full flex-col gap-1.5 rounded-card border border-border bg-surface p-3.5 text-left shadow-[var(--elev-rest)]"
              >
                <div className="flex items-center gap-2">
                  <Bell className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <p className="text-[15px] font-semibold text-ink">{n.title}</p>
                </div>
                <p className="text-xs text-ink-muted">{n.body}</p>
                <span className="text-xs text-ink-faint">{formatSafeDate(n.created_at)}</span>
              </button>
            </li>
          ))}
```

Add the `api` import at the top of the file (check whether it's already imported — if not, add `import api from "@/api/axiosInstance";`).

- [ ] **Step 4: Fold notifications into the Inbox badge count**

In `mobile/src/components/shell/ShellLayout.tsx`, update:

```tsx
  const { rejectedLogs, telepracticeRequests, unreadMessageCount } = useAppData();
```

to:

```tsx
  const { rejectedLogs, telepracticeRequests, unreadMessageCount, notifications } = useAppData();
```

and update:

```tsx
      <TabBar
        inboxCount={rejectedLogs.length + signedTelepracticeCount}
```

to:

```tsx
      <TabBar
        inboxCount={rejectedLogs.length + signedTelepracticeCount + (isIndependentPractitioner ? notifications.filter((n) => !n.read_at).length : 0)}
```

(`isIndependentPractitioner` is already destructured from `useAuth()` on the existing line 13 of this file.)

- [ ] **Step 5: Manual verification — tenant-company practitioner unaffected**

```bash
cd mobile && npm run dev
```

Log in as an existing tenant-company practitioner. Confirm:
- Inbox tab still shows only rejected logs / signed telepractice items, with the exact original empty-state text if there are none.
- No network request to `/api/notifications` fires (check browser devtools Network tab).

- [ ] **Step 6: Manual verification — independent practitioner sees notifications**

Log in as an independent practitioner with at least one unread notification (trigger one via Task 6/7's backend, e.g. by manually inserting a test row into that tenant's `notifications` table, or by completing a real referral flow end-to-end in a local/staging environment). Confirm:
- The notification appears in Inbox with the bell icon.
- Tapping it marks it read (disappears from the list, badge count decrements).
- The badge count on the Inbox tab reflects the combined total.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/types/index.ts mobile/src/contexts/AppDataContext.tsx mobile/src/pages/shell/Inbox.tsx mobile/src/components/shell/ShellLayout.tsx
git commit -m "Surface referral and billing notifications as a new Inbox item type for independent practitioners"
```

---

### Task 10: Frontend price display updates + production rollout

**Files:**
- Modify: `frontend/src/pages/marketing/Practitioners.jsx` (price sticker, CTA copy)
- Modify: `frontend/src/pages/IndependentSignupWizard.jsx` (if price is displayed anywhere in it — grep first)

**Interfaces:** none new — display-only changes plus the deferred production SQL from Tasks 1 and 2.

- [ ] **Step 1: Find every remaining literal "$30" reference**

```bash
grep -rn '\$30' frontend/src/pages/marketing/Practitioners.jsx frontend/src/pages/IndependentSignupWizard.jsx
```

- [ ] **Step 2: Update Practitioners.jsx's price sticker and CTA**

In `frontend/src/pages/marketing/Practitioners.jsx` (as last edited earlier in this session), update:
- The hero CTA: `Get started, $30/month` → `Get started, $19.99/month`
- The price sticker: `<span className="mk-warm-price-now">$30<span>/month, flat</span></span>` → `<span className="mk-warm-price-now">$19.99<span>/month, flat</span></span>`
- Any other literal `$30` found in Step 1.

- [ ] **Step 3: Update IndependentSignupWizard.jsx if it displays the price**

If Step 1 found a match in this file, update it the same way. If no match, skip this step — do not add a price display that doesn't already exist.

- [ ] **Step 4: Build and visually verify**

```bash
cd frontend && npm run build
```

Confirm the build succeeds and the prerendered `/eis/practitioners` page includes `$19.99` (not `$30`):

```bash
grep -o '\$19\.99' frontend/dist/practitioners/index.html
```

- [ ] **Step 5: Commit the frontend changes**

```bash
git add frontend/src/pages/marketing/Practitioners.jsx
git commit -m "Update Izaya One price display to \$19.99/month"
```

(Include `IndependentSignupWizard.jsx` in the `git add` if Step 3 touched it.)

- [ ] **Step 6: Deploy the backend**

Follow this repo's established Cloud Run deploy process (see the project's deploy-process memory/documentation for the exact `gcloud.cmd` invocation from `backend/`). Confirm a new revision lands and serves traffic before continuing.

- [ ] **Step 7: Run the deferred one-off production SQL — platform DB**

Connect to the production `izaya_platform` database (Cloud SQL Studio or `psql`, per this project's established access pattern) and run `backend/db/add_referral_program_platform.sql` (from Task 2 Step 3 and Task 3 Step 1 — confirm both the `referral_redemptions` table and the `pending_signups.referred_by_code` column are included in the version of this file you run).

- [ ] **Step 8: Run the deferred one-off production SQL — retroactive price script**

```bash
cd backend && node scripts/apply-retroactive-price-change.js
```

Review the script's console output: confirm the number of tenants updated matches the expected count of existing independent practitioners, and that no tenant logged a `FAILED` line. If any did, investigate that specific tenant's `company_settings` state before considering this step complete.

- [ ] **Step 9: Deploy the frontend**

Follow this repo's established Vercel deploy process (`npx vercel@62.5.0 deploy --prod --yes` from repo root, per this project's deploy-process memory) for the `progressive-app` project (marketing site / signup wizard).

- [ ] **Step 10: Deploy the mobile app**

Follow the same Vercel deploy process for the `mobile` project (per this project's established swap-and-restore `.vercel/project.json` pattern for deploying to a non-default-linked project from repo root).

- [ ] **Step 11: End-to-end production verification**

1. Visit `https://izayaedge.com/eis/practitioners` and confirm it shows `$19.99/month`.
2. Confirm `https://izayaedge.com/eis/practitioners?ref=<a-real-existing-practitioner-slug>` loads normally and the "Get started" link carries the `?ref=` parameter through to `/signup/independent?ref=...`.
3. Complete a real signup through that referral link in production (or staging if a full production signup isn't practical) and confirm: the confirmation email's wording is correct, the success screen shows the "first month free" message, and the new practitioner's first invoice (once triggered) is waived rather than charged.
4. Confirm an existing independent practitioner's next invoice reflects $19.99, not $30.

- [ ] **Step 12: Final commit (if any deploy-config files changed)**

```bash
git status --short
```

If nothing changed beyond what was already committed in Steps 5, no further commit is needed — this step exists only to confirm production is now running exactly what's in `main`.
