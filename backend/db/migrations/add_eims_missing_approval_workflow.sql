-- Full send-to-admin workflow for "Missing in EIMS" logs, replacing the
-- single-click ceo-approve from add_eims_missing_approval.sql: billing
-- sends the log to admin (optionally with a note), it shows up in the
-- ceo's "Action Required" queue, and the ceo must approve or reject with a
-- required comment (both routed through the existing assessment_notes
-- thread so they surface in Master Reports the same way any other log note
-- does). The older eims_missing_approved_by/at columns are left in place
-- but unused going forward — additive only, no destructive rename.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_missing_status text CHECK (eims_missing_status IN ('sent_to_admin', 'approved', 'rejected'));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_missing_sent_by integer REFERENCES practitioners(id);
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_missing_sent_at timestamptz;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_missing_decided_by integer REFERENCES practitioners(id);
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS eims_missing_decided_at timestamptz;
