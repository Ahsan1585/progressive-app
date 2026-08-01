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
  -- Phase 2 collapsed the 3 fine-grained office-staff values into the single
  -- catch-all 'staff'; what a 'staff' account can do now comes from its
  -- role_id -> roles/role_permissions (see migrations/add_roles_permissions.sql,
  -- which re-applies this identical constraint for already-provisioned tenants).
  CONSTRAINT practitioners_role_check CHECK (role = ANY (ARRAY['practitioner'::text, 'ceo'::text, 'staff'::text]))
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
  parent_name text,
  parent_email text,
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
  hold_note text,
  held_at timestamp with time zone,
  reconciled_at timestamp with time zone,
  group_size_category text,
  PRIMARY KEY (id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id),
  CONSTRAINT assessments_billing_review_check CHECK (billing_review = ANY (ARRAY['accept'::text, 'reject'::text, 'return'::text, 'hold'::text])),
  CONSTRAINT assessments_group_size_category_check CHECK (group_size_category IS NULL OR group_size_category = ANY (ARRAY['individual'::text, 'consultation'::text]))
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

-- pending_contact_updates: one row per practitioner with a self-submitted
-- address/phone change awaiting admin review — the practitioners table
-- itself is only written once a ceo/staff_director/account_specialist
-- accepts it in the Staff Directory (or the row is just deleted on reject).
CREATE TABLE pending_contact_updates (
  practitioner_id integer NOT NULL,
  address text,
  phone_number varchar(20),
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (practitioner_id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id)
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

-- messages: one thread per practitioner (practitioner_id is always the
-- thread owner, even for office-authored rows). sender_id/sender_role
-- record who actually wrote a given message. practitioner_read_at /
-- office_read_at track each side's own last-read point for unread badges.
CREATE SEQUENCE messages_id_seq;
CREATE TABLE messages (
  id integer NOT NULL DEFAULT nextval('messages_id_seq'::regclass),
  practitioner_id integer NOT NULL,
  sender_id integer NOT NULL,
  sender_role text NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  practitioner_read_at timestamp with time zone,
  office_read_at timestamp with time zone,
  PRIMARY KEY (id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id),
  FOREIGN KEY (sender_id) REFERENCES practitioners(id)
);
ALTER SEQUENCE messages_id_seq OWNED BY messages.id;

-- scheduled_sessions: a practitioner-created appointment for one of their
-- patients. If the patient has a parent_email, creating/updating/cancelling
-- a row triggers an email with a calendar (.ics) invite to the parent.
CREATE SEQUENCE scheduled_sessions_id_seq;
CREATE TABLE scheduled_sessions (
  id integer NOT NULL DEFAULT nextval('scheduled_sessions_id_seq'::regclass),
  patient_id integer NOT NULL,
  practitioner_id integer NOT NULL,
  session_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  location text,
  notes text,
  status text NOT NULL DEFAULT 'scheduled',
  parent_notified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(id),
  CONSTRAINT scheduled_sessions_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'cancelled'::text]))
);
ALTER SEQUENCE scheduled_sessions_id_seq OWNED BY scheduled_sessions.id;

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

-- assessment_notes: FK -> assessments, practitioners. One row per note
-- exchanged during a return/resubmit revision cycle (the billing
-- specialist's return note, or the practitioner's note on resubmission) —
-- a full history, since a log can be returned and resubmitted more than
-- once. author_id/author_role mirror messages.sender_id/sender_role.
CREATE SEQUENCE assessment_notes_id_seq;
CREATE TABLE assessment_notes (
  id integer NOT NULL DEFAULT nextval('assessment_notes_id_seq'::regclass),
  assessment_id integer NOT NULL,
  author_id integer NOT NULL,
  author_role text NOT NULL,
  note text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  FOREIGN KEY (author_id) REFERENCES practitioners(id)
);
ALTER SEQUENCE assessment_notes_id_seq OWNED BY assessment_notes.id;
CREATE INDEX idx_assessment_notes_assessment_id ON assessment_notes(assessment_id);

-- company_settings: singleton (id always 1, enforced by CHECK) — this app
-- serves one organization, not multiple tenants. Read by every admin-portal
-- role (shown in the sidebar); written by 'ceo' (labeled "Admin" in the UI)
-- only. logo is a base64 data URL stored inline, same pattern as
-- practitioners.profile_picture/saved_signature — small branding image, no
-- object storage needed.
-- compliance_doc_*: the state-issued Excel reference (e.g. NJEIS required
-- documentation checklist) uploaded on the Company Information page. The
-- file itself lives in the njeis-forms GCS bucket under
-- company/compliance-reference/ (same object-storage pattern as generated
-- PDFs) — only its path/metadata are stored here. Consumed by Batch
-- Review's Compliance Analysis preview to know whether a reference
-- document is on file.
CREATE TABLE company_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  display_name text,
  legal_entity_name text,
  state text,
  timezone text,
  address text,
  phone text,
  billing_email text,
  logo text,
  compliance_doc_path text,
  compliance_doc_filename text,
  compliance_doc_size integer,
  compliance_doc_uploaded_at timestamp with time zone,
  compliance_doc_column_mapping jsonb,
  compliance_doc_custom_fields jsonb DEFAULT '[]',
  compliance_doc_removed_fields jsonb DEFAULT '[]',
  -- Set to compliance_doc_path only once THAT exact uploaded file has had its
  -- mapping confirmed (applyComplianceDocMapping). Replacing the file leaves
  -- compliance_doc_column_mapping in place (so a same-layout replacement can
  -- reuse it without friction) but this stays pointed at the old path — so
  -- "confirmed" status and Compliance Analysis correctly reflect that the
  -- newly-uploaded file hasn't actually been re-applied yet.
  compliance_doc_applied_path text,
  updated_at timestamp with time zone DEFAULT now()
);
-- No hardcoded seed row here (this file is applied to every new tenant
-- database during self-serve signup provisioning, not just one customer's) —
-- the initial id=1 row is inserted by signupController.js with that
-- specific company's own display name/legal entity/address/phone/email.

-- compliance_state_logs: FK -> patients. Parsed rows from the currently
-- attached compliance_doc Excel (backend/src/constants/njeis.js maps the
-- state's free-text Service/Location/Group Size columns to our codes at
-- parse time). Holds a rolling 60-day window keyed off service_date, not a
-- single-file snapshot — each monthly upload only replaces its own covered
-- date range (company/companyController.js applyComplianceDocMapping), and
-- rows older than 60 days are purged automatically on every upload and on
-- every Compliance Analysis read (billingController.js getComplianceAnalysis).
-- patient_id is resolved at parse time via patients.child_id (nullable — a
-- state row for a child not in our system still gets stored, surfaced as unmatched).
CREATE SEQUENCE compliance_state_logs_id_seq;
CREATE TABLE compliance_state_logs (
  id integer NOT NULL DEFAULT nextval('compliance_state_logs_id_seq'::regclass),
  patient_id integer,
  child_id text NOT NULL,
  child_name text,
  practitioner_name text,
  service_label text,
  service_type_label text,
  group_size_label text,
  location_label text,
  service_date date,
  start_time text,
  end_time text,
  service_minutes integer,
  logged_date date,
  ifsp_event_id text,
  mapped_service_code text,
  mapped_location_code text,
  mapped_group_size_code text,
  period_start date,
  period_end date,
  extra_fields jsonb,
  uploaded_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);
ALTER SEQUENCE compliance_state_logs_id_seq OWNED BY compliance_state_logs.id;
CREATE INDEX compliance_state_logs_patient_date_idx ON compliance_state_logs (patient_id, service_date);

-- audit_logs: FK -> practitioners (nullable — actor_email/actor_role are
-- captured redundantly at write time so history reads correctly even if the
-- practitioner is later deactivated or, in principle, removed). HIPAA
-- Security Rule audit-controls requirement (45 CFR 164.312(b)) — records who
-- touched PHI (patient records, compliance doc, generated NJEIS/invoice/audit
-- PDFs) and when. Written via backend/src/utils/auditLog.js's logAudit()
-- helper, fire-and-forget so a logging hiccup never blocks the real request.
-- Append-only from the app's perspective — no UPDATE/DELETE code path exists.
CREATE SEQUENCE audit_logs_id_seq;
CREATE TABLE audit_logs (
  id integer NOT NULL DEFAULT nextval('audit_logs_id_seq'::regclass),
  actor_id integer,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  details jsonb,
  ip_address text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (actor_id) REFERENCES practitioners(id) ON DELETE SET NULL
);
ALTER SEQUENCE audit_logs_id_seq OWNED BY audit_logs.id;
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_id_idx ON audit_logs (actor_id);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id);
