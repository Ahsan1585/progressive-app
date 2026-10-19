-- Distinguishes a practitioner's own self-discharge toggle (patient stays
-- inactive but still fully visible to them) from an office reassignment
-- (the old practitioner should lose access entirely, immediately — FERPA/
-- IDEA Part C §303.404). Both previously set the same status='inactive'
-- with no way to tell them apart.
ALTER TABLE patient_practitioners ADD COLUMN IF NOT EXISTS deactivated_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_practitioners_deactivated_reason_check'
  ) THEN
    ALTER TABLE patient_practitioners ADD CONSTRAINT patient_practitioners_deactivated_reason_check
      CHECK (deactivated_reason IS NULL OR deactivated_reason IN ('discharged', 'reassigned'));
  END IF;
END $$;
