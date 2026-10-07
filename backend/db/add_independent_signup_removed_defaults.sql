-- Standalone one-off migration for the existing izaya_platform database —
-- same convention as add_independent_signup_address_parts.sql.
--
-- Lets a practitioner un-check default seeded dropdown options they don't
-- want (e.g. "I never do Escort/Security") during the Vocabulary step of
-- signup, carried through the pending-confirmation window the same way
-- custom_dropdown_options already does. confirmIndependentSignup
-- soft-deactivates each (category, label) match in the new tenant right
-- after provisioning (see independentSignupController.js).
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS removed_default_options jsonb;
