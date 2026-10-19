-- Final-review fix (2026-10-19): the consent gate was matching only on
-- recipient_name (a free-text agency/affiliation label), never on the
-- actual email address a disclosure is sent to — a consent for "ABC
-- Billing" passed the gate for a send to ANY address, since
-- company_affiliation and the practitioner-typed agencyEmail are two
-- independent fields with no required relationship. This column lets the
-- gate match on the real destination when the disclosure is email-based.
-- Nullable: a future non-email disclosure point may have no address to
-- record, in which case the name-only match remains the fallback.
ALTER TABLE records_consents ADD COLUMN IF NOT EXISTS recipient_email text;
