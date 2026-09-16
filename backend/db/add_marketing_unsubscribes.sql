-- Standalone one-off migration for the existing izaya_platform database —
-- same convention as add_promo_codes.sql. This table has nothing to do
-- with any tenant's business data or the companies/practitioners tables;
-- it's Izaya's own outbound-marketing suppression list (e.g. the trial
-- newsletter's unsubscribe link), scoped to a bare email address since
-- there's no mailing-list/campaign system to tie a recipient ID to.
--
-- Case-insensitive uniqueness (lower(email)) has to be a unique INDEX, not
-- a UNIQUE table CONSTRAINT — Postgres constraints can only reference
-- plain columns, not expressions. The index below also serves as the
-- lookup index, so there's no separate plain index on top of it.

CREATE TABLE IF NOT EXISTS marketing_unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  source text -- e.g. 'newsletter_link' — free-form, for future distinctions between sends/lists
);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_unsubscribes_email_key ON marketing_unsubscribes (lower(email));
