CREATE TABLE IF NOT EXISTS dropdown_options (
  id SERIAL PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('service_type', 'service_status', 'location', 'group_size')),
  code text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (category, code)
);

-- Seeds the table with the vocabulary that used to be hardcoded in
-- backend/src/constants/njeis.js, so switching to the DB-backed cache is a
-- no-op for existing behavior. ON CONFLICT DO NOTHING means this only takes
-- effect on the very first boot after this migration ships — later boots
-- (and any admin edits since) leave the table alone.
INSERT INTO dropdown_options (category, code, label, sort_order) VALUES
  ('service_type', 'EV', 'Evaluation', 0),
  ('service_type', 'AS', 'Assessment', 1),
  ('service_type', 'IFSP', 'IFSP Meeting', 2),
  ('service_type', 'AU', 'Audiology', 3),
  ('service_type', 'DI', 'Developmental Intervention', 4),
  ('service_type', 'FT', 'Family Training', 5),
  ('service_type', 'HS', 'Health Service', 6),
  ('service_type', 'MS', 'Medical Service', 7),
  ('service_type', 'NU', 'Nursing', 8),
  ('service_type', 'NT', 'Nutrition', 9),
  ('service_type', 'OT', 'Occupational Therapy', 10),
  ('service_type', 'PT', 'Physical Therapy', 11),
  ('service_type', 'PSY', 'Psychological', 12),
  ('service_type', 'SLP', 'Speech Language Therapy', 13),
  ('service_type', 'SW', 'Social Work', 14),
  ('service_type', 'VI', 'Vision', 15),
  ('service_type', 'CC', 'Childcare/Respite', 16),
  ('service_type', 'I/T', 'Interpreter/Translator', 17),
  ('service_type', 'ES', 'Escort/Security', 18),
  ('service_type', 'TPC', 'Transition Planning Conference', 19),

  ('service_status', '1', 'Direct Child Service', 0),
  ('service_status', '2', 'Practitioner Cancelled (inc weather related)', 1),
  ('service_status', '3', 'Family Cancelled (inc weather related)', 2),
  ('service_status', '4', 'Make Up Direct Child Service', 3),
  ('service_status', '5', 'Family Missed (within 3 hours)', 4),
  ('service_status', 'IFSP', 'Team Mtg – IFSP', 5),
  ('service_status', 'TPC', 'Transition Planning Conference', 6),
  ('service_status', 'IT', 'Bilingual Interpretation', 7),

  ('location', '1', 'Home', 0),
  ('location', '2', 'Residential Facility', 1),
  ('location', '3', 'Service Provider Clinic/Office', 2),
  ('location', '4', 'Hospital (Inpatient)', 3),
  ('location', '5', 'EC Program - Children with Disabilities', 4),
  ('location', '6', 'EC Program - Inclusive Community', 5),
  ('location', '7', 'DCP&P Office', 6),
  ('location', '8', 'Phone/Video Conferencing', 7),

  ('group_size', 'individual', 'Direct Child Service - Individual', 0),
  ('group_size', 'consultation', 'Consultation/Facilitation with Others', 1)
ON CONFLICT (category, code) DO NOTHING;
