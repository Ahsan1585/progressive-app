-- Subscription billing: what the agency (company_settings, our one tenant)
-- owes Izaya each month for the app itself — distinct from billing_invoices
-- / billing_batches, which are the agency's own pay invoices to its
-- practitioners. Usage-based: $/active-practitioner + $/extra-office-seat
-- beyond the included allotment, computed fresh each period rather than a
-- flat recurring price, since headcount changes month to month.
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_subscription_billing.sql

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS subscription_price_per_practitioner numeric(10,2) NOT NULL DEFAULT 18.00,
  ADD COLUMN IF NOT EXISTS subscription_included_staff_seats integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS subscription_extra_staff_seat_price numeric(10,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS subscription_started_at timestamp with time zone,
  -- Stripe Customer: one per company (singleton tenant). Created lazily on
  -- first payment-method setup, once STRIPE_SECRET_KEY is configured.
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_default_payment_method_id text,
  ADD COLUMN IF NOT EXISTS stripe_default_pm_type text, -- 'card' | 'google_pay'
  ADD COLUMN IF NOT EXISTS stripe_default_pm_brand text,
  ADD COLUMN IF NOT EXISTS stripe_default_pm_last4 text,
  ADD COLUMN IF NOT EXISTS stripe_default_pm_exp text;

-- subscription_invoices: one row per closed billing period (calendar month).
-- Amounts are snapshotted at generation time (price_per_practitioner etc.)
-- so a later plan-price change never rewrites history. status starts
-- 'pending' and moves to 'paid'/'failed' via the Stripe webhook once a
-- charge attempt resolves — while Stripe isn't configured, invoices simply
-- stay 'pending' with no charge attempted.
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  active_practitioner_count integer NOT NULL DEFAULT 0,
  price_per_practitioner numeric(10,2) NOT NULL,
  practitioner_charge numeric(10,2) NOT NULL DEFAULT 0.00,
  office_staff_count integer NOT NULL DEFAULT 0,
  included_staff_seats integer NOT NULL DEFAULT 0,
  extra_staff_seats integer NOT NULL DEFAULT 0,
  extra_staff_seat_price numeric(10,2) NOT NULL DEFAULT 0.00,
  extra_staff_charge numeric(10,2) NOT NULL DEFAULT 0.00,
  total_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'pending',
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  failure_reason text,
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT subscription_invoices_period_key UNIQUE (period_start, period_end),
  CONSTRAINT subscription_invoices_status_check CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'void'::text]))
);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_period_start ON subscription_invoices (period_start DESC);
