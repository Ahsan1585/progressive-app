ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS free_months_owed integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS waived_by_referral boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at DESC);
