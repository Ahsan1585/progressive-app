# Izaya One: $19.99 price change + automated referral program + Inbox notifications

Scope: Izaya One (independent-practitioner) product line only. Tenant-company
practitioners and the tenant-company app/billing path are unaffected by every
change in this spec unless explicitly noted.

## 1. Price change: $30 → $19.99/month, retroactive

- `company_settings.subscription_flat_price` (per-tenant, one row per
  independent practitioner's own single-seat tenant database) changes its
  default from `30.00` to `19.99` for all new independent-practitioner
  signups.
- **Retroactive**: a one-time migration/script updates `subscription_flat_price`
  to `19.99` on every *existing* independent practitioner's tenant DB,
  effective their next billing cycle (does not touch already-issued/paid
  `subscription_invoices` rows — those keep their original historical amount
  for audit purposes).
- Frontend display updates: `frontend/src/pages/marketing/Practitioners.jsx`
  ($30 price sticker + CTA copy), `frontend/src/pages/IndependentSignupWizard.jsx`
  (if price is shown), any other literal "$30" reference found at
  implementation time.
- Out of scope: Stripe has no subscription/price object to update (confirmed —
  this codebase charges a flat app-computed amount via PaymentIntents, not a
  Stripe Subscription; see research below). No Stripe-side price change is
  needed.

## 2. Referral program

### 2.1 Mechanics (confirmed with user)

- Every independent practitioner's existing signup slug IS their referral
  code. No new code to generate. Referral link format:
  `https://izayaedge.com/eis/practitioners?ref=<slug>`.
- Referral code capture is **link-only** — no manual "enter a code" field
  anywhere in the signup wizard.
- **Referred practitioner**: their first month is free, automatically, no
  charge ever attempted for invoice #1. This is unconditional — granted the
  moment they sign up via a valid ref link, not contingent on anything else.
- **Referrer**: earns one free month, automatically, the moment the referred
  practitioner's **second** invoice (their first ever real paid charge)
  succeeds. This delay (to the 2nd payment, not the 1st) is deliberate —
  guards against a referral being "redeemed" by a signup that never actually
  becomes a paying customer.
- Unlimited — no cap on how many free months a practitioner can earn via
  referrals.
- **Free-month credits always take priority over autopay.** In
  `closePeriodInvoice`, if a tenant has `free_months_owed > 0`, that is
  consumed and no Stripe charge is attempted that cycle, even though a saved
  card/autopay is active.

### 2.2 Data model

All new tables/columns, no existing table's meaning changes.

**Platform DB (`izaya_platform`):**

```sql
ALTER TABLE companies ADD COLUMN referred_by_company_id integer REFERENCES companies(id);

CREATE TABLE referral_redemptions (
  id serial PRIMARY KEY,
  referrer_company_id integer NOT NULL REFERENCES companies(id),
  referred_company_id integer NOT NULL REFERENCES companies(id) UNIQUE,
  referred_display_name text NOT NULL, -- snapshot, survives referred account deletion
  referred_first_waived_at timestamptz NOT NULL DEFAULT now(),
  referred_second_payment_at timestamptz, -- set when the vesting trigger fires
  referrer_rewarded_at timestamptz,       -- set when the referrer's credit is actually granted
  created_at timestamptz NOT NULL DEFAULT now()
);
```

(Mirrors the existing `promo_codes`/`promo_code_redemptions` precedent —
same database, same FK-to-`companies` shape, same one-row-per-redemption
idempotency pattern via the `UNIQUE` on `referred_company_id`.)

**Per-tenant `company_settings` (both the referrer's own tenant DB and the
referred practitioner's own tenant DB — each independent practitioner has
their own single-seat tenant database):**

```sql
ALTER TABLE company_settings ADD COLUMN free_months_owed integer NOT NULL DEFAULT 0;
```

**Per-tenant `subscription_invoices`:**

```sql
ALTER TABLE subscription_invoices ADD COLUMN waived_by_referral boolean NOT NULL DEFAULT false;
```

### 2.3 Signup flow (capturing the referral)

1. `frontend/src/pages/marketing/Practitioners.jsx` reads `?ref=` via
   `useSearchParams()` on mount and forwards it onto every sign-up CTA link
   as `/signup/independent?ref=<code>`.
2. `frontend/src/pages/IndependentSignupWizard.jsx` reads `?ref=` once on
   mount, stores it in `form.referredByCode` (invisible — no UI field), and
   includes it in the `POST /api/independent-signup` payload.
3. `backend/src/controllers/independentSignupController.js`:
   - `requestIndependentSignup`: validates `referredByCode` against
     `companies.slug` (must resolve to an existing `account_type='independent'`,
     non-cancelled company). An invalid/unknown code is silently ignored
     (never blocks or errors the signup) and stored as `null`. Valid code is
     stored on the `pending_signups` row (new nullable column
     `referred_by_code text`).
   - `confirmIndependentSignup`: if `referred_by_code` resolves to a real
     company, sets the new `companies.referred_by_company_id`, pre-loads the
     new tenant's own `company_settings.free_months_owed = 1` (this is what
     makes invoice #1 free — no special-casing needed in the billing code
     itself), and inserts the initial `referral_redemptions` row
     (`referred_first_waived_at = now()`).

### 2.4 Billing integration (`closePeriodInvoice`)

In `backend/src/controllers/subscriptionController.js`, before the existing
`stripe.paymentIntents.create(...)` call:

1. Read `company_settings.free_months_owed` for this tenant.
2. If `> 0`: skip the Stripe call entirely. Mark the `subscription_invoices`
   row `status='paid'`, `waived_by_referral=true`, decrement
   `free_months_owed` by 1.
3. Else: fall through to the existing (unchanged) Stripe charge path.

This is the only change to the existing charge call site — one new
early-exit branch, no change to the PaymentIntent call itself.

### 2.5 Referrer reward trigger (webhook)

In the existing `stripeWebhook` handler's `payment_intent.succeeded` branch
(`subscriptionController.js`): when a tenant's invoice is confirmed paid via
a *real* Stripe charge (never via `waived_by_referral`), and it is that
tenant's 2nd-ever paid invoice:

1. Look up `referral_redemptions` by `referred_company_id = <this tenant's
   platform company id>`.
2. If found and `referrer_rewarded_at IS NULL`:
   - Increment the referrer's own tenant `company_settings.free_months_owed`
     by 1 (cross-tenant write via the existing `runWithTenant` helper, same
     pattern the webhook already uses to resolve a tenant from
     `stripeCustomerId`).
   - Set `referred_second_payment_at = now()`, `referrer_rewarded_at = now()`
     on the redemption row (this UPDATE, keyed on the `UNIQUE
     referred_company_id`, is the idempotency guard against double-rewarding
     on webhook retries).
   - Write a `notifications` row for the referrer (see §3) and send the
     referrer's "you earned a free month" email.

### 2.6 Messaging (exact copy, to avoid ambiguity)

| Surface | Copy |
|---|---|
| Signup wizard success screen (only if a valid ref code was used) | "Your first month is free, thanks to [referrer's name]." |
| Referred practitioner's confirmation email | Same line + one-sentence explainer of what a referral is. |
| Referrer's new "Referral program" screen — per-referral status | `Invited` (signed up, hasn't paid 2nd month yet) → `Reward earned on <date>` (vested) |
| Referrer's new "Referral program" screen — header stat | "Free months earned: N" |
| Referrer's reward email (sent the moment it vests) | "[referred practitioner]'s second payment just went through — you've earned a free month on Izaya One." |
| In-app notification (Inbox, referred side) | "Your first month is on us 🎉" |
| In-app notification (Inbox, referrer side) | "[name] just earned you a free month." |

### 2.7 New backend endpoint

`GET /api/referrals` — independent-practitioner-only (same
`[protect, loadPermissions, requireRole(['independent_practitioner'])]` guard
used by the existing billing routes). Returns:
- current `free_months_owed` (spendable balance)
- all `referral_redemptions` rows where `referrer_company_id = this
  practitioner's company`, each with `referred_display_name`, status
  (`invited` | `rewarded`), and the relevant date.

### 2.8 New mobile screen: Referral program

`mobile/src/pages/ReferralProgram.tsx`, pattern-matched to the existing
`mobile/src/pages/MySubscription.tsx` (`PushScreen` + `AppBar`, stat card +
list card, no native Stripe SDK needed — pure read-only `GET` calls):

- Hero stat card: "Free months earned" (count of `rewarded` redemptions) +
  current unspent `free_months_owed` balance.
- "Your referral link" card: full shareable URL
  (`https://izayaedge.com/eis/practitioners?ref=<my-slug>`) + copy button +
  native share sheet button.
- List of referrals with status badges (`Invited` / `Reward earned on
  <date>`), using the exact copy from §2.6.

New route `/profile/referrals` in `mobile/src/App.tsx`, new row in
`mobile/src/pages/shell/Profile.tsx`'s independent-practitioner-only menu
section (pattern-matched to the existing "Work details"/"My subscription"
rows — icon + label + chevron, `navigate('/profile/referrals')`).

### 2.9 Emails

Two new Resend templates in `backend/src/utils/emailClient.js`, following
the existing fork-don't-parameterize convention (separate functions, not one
parameterized template — matches how `sendIndependentSignupConfirmationEmail`
is already a deliberate fork of the tenant-company version):
- `sendReferralFirstMonthFreeEmail(to, referrerName)` — sent at signup
  confirmation when a valid ref code was used.
- `sendReferralRewardEarnedEmail(to, referredName)` — sent to the referrer
  when their reward vests (§2.5).

Both use `logoUrl: IZAYA_ONE_LOGO_URL` (this entire feature is Izaya-One-only).

## 3. Inbox notifications (Izaya One only)

### 3.1 Scope and approach

- **No new tab, no rename.** The existing "Inbox" tab/route/icon/label are
  unchanged for everyone, including independent practitioners.
- Today, `mobile/src/pages/shell/Inbox.tsx` is one shared component/route
  for both tenant-company and independent practitioners, rendering two
  item kinds (rejected/declined billing logs, signed telepractice requests)
  from two separate fetched arrays with no generic "item type" abstraction.
- This spec adds a **third item kind — system notifications — rendered only
  when `isIndependentPractitioner` is true** (gated via `useAuth()`, the
  same flag already used in `ShellLayout.tsx`/`TabBar.tsx`). Tenant-company
  practitioners' Inbox is visually and functionally byte-for-byte unchanged:
  the new fetch is never made for them, so the new render block never
  mounts.

### 3.2 Data model

New table, per-tenant (each independent practitioner's own tenant DB — this
is role-specific data, and independent practitioners already have 1:1
tenant DBs, matching how `company_settings`/`subscription_invoices` already
work for this role):

```sql
CREATE TABLE notifications (
  id serial PRIMARY KEY,
  type text NOT NULL, -- 'referral_first_month_free' | 'referral_reward_earned' | 'bill_due_soon' | 'payment_failed'
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
```

### 3.3 Backend

New `backend/src/controllers/notificationController.js` +
`backend/src/routes/notificationRoutes.js`:
- `GET /api/notifications` — list, newest first.
- `POST /api/notifications/:id/read` — marks read.

Both gated `role === 'independent_practitioner'` server-side (matching the
existing gating pattern already used in
`telepracticeSignatureController.js`). For a tenant-company practitioner,
these routes are simply never called (the client never fetches them), so no
new server-side behavior is exposed to that role in practice, but the
role check is added anyway as defense in depth.

**Writers** (each a row insert into this table from the relevant existing
code path — no new infrastructure, just an added `INSERT`):
- Signup confirmation (referred practitioner, §2.3 step 3) → `type:
  'referral_first_month_free'`.
- Webhook referrer-reward branch (§2.5) → `type: 'referral_reward_earned'`.
- Existing monthly billing cron, a few days before an invoice would be due
  → `type: 'bill_due_soon'`.
- Existing failed-payment path (`subscription_invoices.status = 'failed'`)
  → `type: 'payment_failed'`.

### 3.4 Frontend

- `mobile/src/contexts/AppDataContext.tsx`: new `notifications` /
  `notificationsLoading` / `fetchNotifications` triple (matches the existing
  `fetchX`/`xLoading` pattern already used for `rejectedLogs` etc.), fetched
  only when `isIndependentPractitioner`.
- `mobile/src/pages/shell/Inbox.tsx`: new third `.map()` block, rendered only
  when `isIndependentPractitioner` (imported via `useAuth()` — not currently
  imported in this file), with its own card style (informational, no
  resubmit/acknowledge action — tapping just marks read). Empty-state copy
  gets a small independent-practitioner-only addition to account for the new
  possible item kind; tenant-company's empty-state string is untouched.
- Badge count: fold into the existing client-side sum computed in
  `mobile/src/components/shell/ShellLayout.tsx`
  (`rejectedLogs.length + signedTelepracticeCount`) by adding
  `+ unreadNotifications.length` when `isIndependentPractitioner` — matches
  Inbox's existing client-computed-sum pattern rather than introducing a
  separate server-computed count (which is how Messages' different badge
  works, and is intentionally not replicated here).

## 4. Out of scope / explicitly not changing

- Tenant-company practitioners: zero behavior change anywhere in this spec.
- The existing Messages tab/feature: untouched.
- Stripe Subscriptions, Coupons, or customer balance: not introduced: this
  codebase has none of these today and everything above is built as a
  pure application-level credit ledger, consistent with the existing
  `promo_codes` precedent.
- No cap on referral earnings.
- No manual/typed referral code entry field.

## 5. Open questions resolved during design (for traceability)

- Price rollout: retroactive to all existing independent practitioners
  (not new-signups-only).
- Referral code entry: link-only (`?ref=`), no manual field.
- Referred reward: first invoice fully waived (not "pay month 1, get month
  2 free").
- Referrer reward timing: on the referred practitioner's 2nd successful
  payment (not their 1st, and not at mere signup confirmation) — explicit
  anti-fraud/anti-churn guard.
- Credits vs. autopay: credits always consumed first, even with a saved
  card/autopay active.
- Referral code format: reuse the existing signup slug, no separate
  generated code.
- Referral cap: unlimited.
- Notifications surface: folded into the existing Inbox tab as a new item
  type, not a new/renamed tab — confirmed explicitly after initially
  proposing a new "Notifications" tab.
