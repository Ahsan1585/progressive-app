-- NJEIS Encounter Tracker — reverse-engineered schema snapshot
--
-- Extracted directly from the live Supabase Postgres instance via a
-- Node/pg introspection script (pg_dump was not available in the local
-- environment). Supabase-injected artifacts have been stripped:
--   - Auto-generated "N_N_N_not_null" CHECK constraints (redundant with
--     the column-level NOT NULL already present).
--   - Row Level Security: RLS was enabled on all 6 tables with two
--     permissive/no-op policies (patients: allow all INSERTs;
--     master_reports: allow all commands), both scoped to Supabase's
--     "authenticated" role. The app never uses Supabase Auth or that
--     role (it connects with the service_role key, which bypasses RLS
--     entirely), so these are Supabase dashboard boilerplate with zero
--     functional effect on the app. Not reproduced here — Cloud SQL's
--     application user has no RLS applied and none is needed, since
--     authorization is enforced entirely in Express middleware.
--   - supabase_vault extension and other Supabase-platform-only objects
--     (pg_graphql, pg_net, pg_cron grants, realtime publications) —
--     none are used by the app.
--
-- Note: billing_invoices exists in the live database but is not
-- referenced anywhere in the current backend code (superseded by
-- billing_batches, which stores generated PDFs in object storage
-- instead of DB rows). Included here for completeness/data preservation
-- during migration, but no application code targets it.
--
-- Apply with: psql "<connection string>" -f backend/db/schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- practitioners: no dependencies
CREATE SEQUENCE practitioners_id_seq;
CREATE TABLE practitioners (
  id integer NOT NULL DEFAULT nextval('practitioners_id_seq'::regclass),
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  requires_password_change boolean DEFAULT true,
  saved_signature text,
  first_name text,
  last_name text,
  pay_rate numeric(10,2) NOT NULL DEFAULT 0.00,
  position_title text DEFAULT 'Therapist'::text,
  address text,
  phone_number varchar(20),
  ssn varchar(11),
  role text NOT NULL DEFAULT 'practitioner'::text,
  reset_token_hash text,
  reset_token_expires timestamp with time zone,
  is_active boolean NOT NULL DEFAULT true,
  service_types text[] DEFAULT '{}'::text[],
  profile_picture text,
  PRIMARY KEY (id),
  CONSTRAINT practitioners_email_key UNIQUE (email),
  CONSTRAINT practitioners_role_check CHECK (role = ANY (ARRAY['practitioner'::text, 'staff_director'::text, 'billing'::text, 'ceo'::text, 'account_specialist'::text]))
);
ALTER SEQUENCE practitioners_id_seq OWNED BY practitioners.id;

-- patients: FK -> practitioners
CREATE SEQUENCE patients_id_seq;
CREATE TABLE patients (
  id integer NOT NULL DEFAULT nextval('patients_id_seq'::regclass),
  first_name text NOT NULL,
  last_name text NOT NULL,
  middle_name text,
  dob date NOT NULL,
  county text NOT NULL,
  child_id text NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  practitioner_id integer,
  status text NOT NULL DEFAULT 'active',
  PRIMARY KEY (id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id),
  CONSTRAINT patients_child_id_key UNIQUE (child_id),
  CONSTRAINT patients_status_check CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text]))
);
ALTER SEQUENCE patients_id_seq OWNED BY patients.id;

-- assessments: FK -> patients, practitioners
CREATE SEQUENCE assessments_id_seq;
CREATE TABLE assessments (
  id integer NOT NULL DEFAULT nextval('assessments_id_seq'::regclass),
  patient_id integer,
  practitioner_id integer NOT NULL,
  form_data jsonb NOT NULL,
  parent_signature text NOT NULL,
  practitioner_signature text NOT NULL,
  completed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  service_date date,
  start_time text,
  end_time text,
  total_time integer,
  status text DEFAULT 'pending'::text,
  type text,
  location text,
  patient_first_name text,
  patient_last_name text,
  patient_dob date,
  practitioner_first_name text,
  practitioner_last_name text,
  practitioner_discipline text,
  patient_county text,
  reviewed_at timestamp with time zone,
  admin_notes text,
  billing_status text DEFAULT 'pending'::text,
  rejection_note text,
  rejected_at timestamp with time zone,
  rejection_count integer DEFAULT 0,
  billing_review text,
  billing_batch_id uuid,
  acknowledged_at timestamp with time zone,
  is_override boolean DEFAULT false,
  practitioner_response text,
  responded_at timestamp with time zone,
  PRIMARY KEY (id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id),
  CONSTRAINT assessments_billing_review_check CHECK (billing_review = ANY (ARRAY['accept'::text, 'reject'::text, 'return'::text]))
);
ALTER SEQUENCE assessments_id_seq OWNED BY assessments.id;

-- billing_batches: FK -> practitioners
CREATE TABLE billing_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  practitioner_id integer,
  start_date date,
  end_date date,
  njeis_path text,
  invoice_path text,
  created_at timestamp with time zone DEFAULT now(),
  printed_at timestamp with time zone,
  paid_at timestamp with time zone,
  stamped_invoice_path text,
  PRIMARY KEY (id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id)
);
-- assessments.billing_batch_id references this table but has no formal FK
-- constraint in the source DB either; not adding one here to match exactly.

-- billing_locks: one row per practitioner currently claimed by a billing
-- specialist on the Pending Bills tab, so two specialists can't work the
-- same practitioner's logs at once. No expiry — released explicitly by the
-- lock holder, automatically after Generate & Issue, or force-released by a ceo.
CREATE TABLE billing_locks (
  practitioner_id integer NOT NULL,
  locked_by integer NOT NULL,
  locked_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (practitioner_id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id),
  FOREIGN KEY (locked_by) REFERENCES practitioners(id)
);

-- billing_invoices: FK -> practitioners (unused by current app code, see note above)
CREATE TABLE billing_invoices (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  practitioner_id integer,
  company_name varchar DEFAULT 'Progressive Steps'::character varying,
  company_address text,
  company_phone varchar,
  ein_ssn varchar,
  service_types jsonb,
  line_items jsonb NOT NULL,
  invoice_status varchar DEFAULT 'issued'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  pdf_path text,
  total_billed_amount numeric(10,2),
  PRIMARY KEY (id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id)
);

-- master_reports: FK -> patients, practitioners
CREATE SEQUENCE master_reports_id_seq;
CREATE TABLE master_reports (
  id integer NOT NULL DEFAULT nextval('master_reports_id_seq'::regclass),
  practitioner_id integer NOT NULL,
  patient_id integer,
  child_name text NOT NULL,
  date_range text NOT NULL,
  total_hours numeric(10,2) NOT NULL DEFAULT 0.00,
  included_assessment_ids jsonb NOT NULL,
  njeis_pdf_path text,
  status text NOT NULL DEFAULT 'pending_approval'::text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id)
);
ALTER SEQUENCE master_reports_id_seq OWNED BY master_reports.id;
