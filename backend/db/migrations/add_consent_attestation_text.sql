-- The exact attestation wording a parent agreed to when e-signing a
-- disclosure consent (consentSigningController.signConsent), so the
-- disclosure packet's signed-consent copy can quote it verbatim. Paper and
-- pre-existing consents leave it NULL (shown as "not recorded").
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS attestation_text text;
