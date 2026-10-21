-- IDEA Part C 34 CFR 303.405: a parent's request to inspect/review their
-- child's records must be fulfilled without unnecessary delay and within 10
-- days. One row per request; due_at is stored (requested_at + 10 days).
CREATE TABLE IF NOT EXISTS records_inspection_requests (
  id serial PRIMARY KEY,
  patient_id integer NOT NULL REFERENCES patients(id),
  requested_by_name text NOT NULL,
  requested_by_relationship text,
  requested_at date NOT NULL,
  received_by integer REFERENCES practitioners(id),
  identity_verified_method text NOT NULL
    CHECK (identity_verified_method IN ('known_parent','photo_id','callback_verified','in_person','other')),
  identity_verified_note text,
  due_at date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fulfilled','denied')),
  fulfilled_at timestamptz,
  fulfilled_by integer REFERENCES practitioners(id),
  fulfillment_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_inspection_requests_patient_idx ON records_inspection_requests (patient_id);
CREATE INDEX IF NOT EXISTS records_inspection_requests_status_idx ON records_inspection_requests (status, due_at);
