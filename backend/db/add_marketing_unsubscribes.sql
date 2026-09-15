-- Standalone one-off migration for the existing izaya_platform database —
-- same convention as add_promo_codes.sql. This table has nothing to do
-- with any tenant's business data or the companies/practitioners tables;
-- it's Izaya's own outbound-marketing suppression list (e.g. the trial
-- newsletter's unsubscribe link), scoped to a bare email address since
-- there's no mailing-list/campaign system to tie a recipient ID to.

CREATE TABLE IF NOT EXISTS marketing_unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  source text, -- e.g. 'newsletter_link' — free-form, for future distinctions between sends/lists
  CONSTRAINT marketing_unsubscribes_email_key UNIQUE (lower(email))
);
CREATE INDEX IF NOT EXISTS marketing_unsubscribes_email_idx ON marketing_unsubscribes (lower(email));
