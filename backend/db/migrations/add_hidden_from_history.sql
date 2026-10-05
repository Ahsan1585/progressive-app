-- Independent-practitioner-only: lets a practitioner hide a 'voided'
-- (self-rejected — see patientController.voidCompletedLog) session from
-- their own Session History list, once it's served its purpose as a
-- record. Purely a display preference — the row and all its data (notes,
-- EIMS-entered status, etc.) are untouched and still exist; this never
-- deletes anything, so it stays fully reversible and auditable. Toggleable
-- back off the same way billing_status itself and eims_entered_at are.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS hidden_from_history boolean NOT NULL DEFAULT false;
