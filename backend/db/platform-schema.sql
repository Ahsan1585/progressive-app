-- izaya_platform: Izaya's own tenant registry, a database entirely separate
-- from every customer company's tenant database. Holds no clinical/billing
-- data — just enough to resolve a login/signup slug to the right tenant
-- database, and to track trial/BAA status. See docs/superpowers/specs (or
-- the multi-tenant-foundation plan) for the full design.
--
-- Apply once with: psql "<connection string, connected to izaya_platform>" -f backend/db/platform-schema.sql
-- (the database itself, `CREATE DATABASE izaya_platform`, must be created first — see backend/db/README.md)

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  display_name text NOT NULL,
  legal_entity_name text,
  address text,
  phone text,
  email text NOT NULL,
  tenant_db_name text NOT NULL,
  status text NOT NULL DEFAULT 'trial',
  trial_ends_at timestamptz,
  stripe_customer_id text,
  baa_accepted_at timestamptz,
  baa_accepted_by_name text,
  baa_accepted_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_slug_key UNIQUE (slug),
  CONSTRAINT companies_tenant_db_name_key UNIQUE (tenant_db_name),
  CONSTRAINT companies_slug_format_check CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  CONSTRAINT companies_status_check CHECK (status = ANY (ARRAY['trial'::text, 'active'::text, 'suspended'::text, 'cancelled'::text]))
);
CREATE INDEX IF NOT EXISTS companies_slug_idx ON companies (slug);
CREATE INDEX IF NOT EXISTS companies_stripe_customer_id_idx ON companies (stripe_customer_id);

-- Pending signups that haven't clicked their email-confirmation link yet —
-- deliberately separate from `companies` so an unconfirmed signup never
-- consumes a real tenant database (see signupController.js: provisioning
-- only happens once this row's token is confirmed).
CREATE TABLE IF NOT EXISTS pending_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  display_name text NOT NULL,
  legal_entity_name text,
  address text,
  phone text,
  email text NOT NULL,
  ceo_first_name text NOT NULL,
  ceo_last_name text NOT NULL,
  ceo_email text NOT NULL,
  ceo_password_hash text NOT NULL,
  baa_accepted_at timestamptz NOT NULL,
  baa_accepted_by_name text NOT NULL,
  baa_accepted_by_email text NOT NULL,
  confirm_token_hash text NOT NULL,
  confirm_token_expires timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_signups_slug_key UNIQUE (slug)
);
CREATE INDEX IF NOT EXISTS pending_signups_confirm_token_hash_idx ON pending_signups (confirm_token_hash);
