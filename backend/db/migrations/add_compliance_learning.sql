ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS compliance_strictness text DEFAULT 'moderate';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_settings_compliance_strictness_check'
  ) THEN
    ALTER TABLE company_settings ADD CONSTRAINT company_settings_compliance_strictness_check
      CHECK (compliance_strictness IN ('strict', 'moderate', 'lenient'));
  END IF;
END $$;

-- Learned rules: a billing-confirmed (field, state's raw text, our value)
-- pairing that Compliance Analysis auto-matches on every future run,
-- regardless of the active strictness level — this is what lets a single
-- "Allow" decision fix every future occurrence of the same labeling
-- difference, rather than requiring a human to re-confirm it every time.
CREATE TABLE IF NOT EXISTS compliance_match_overrides (
  id SERIAL PRIMARY KEY,
  field_key text NOT NULL,
  state_value_normalized text NOT NULL,
  state_value_raw text NOT NULL,
  our_value text NOT NULL,
  created_by integer REFERENCES practitioners(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (field_key, state_value_normalized, our_value)
);

-- One-off "allow just this log" record — applies to any field, including
-- fields that don't generalize into a learned rule (e.g. a one-time state
-- clerical typo on a time field). Also doubles as the audit record for a
-- learnable field's first confirmation.
CREATE TABLE IF NOT EXISTS compliance_field_acknowledgments (
  id SERIAL PRIMARY KEY,
  assessment_id integer NOT NULL REFERENCES assessments(id),
  field_key text NOT NULL,
  our_value text,
  state_value text,
  allowed_by integer REFERENCES practitioners(id),
  allowed_at timestamptz DEFAULT now(),
  UNIQUE (assessment_id, field_key)
);
