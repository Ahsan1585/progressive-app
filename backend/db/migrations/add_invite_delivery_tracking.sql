-- Invite-email delivery tracking. When an activation invite goes out we now
-- capture the Resend message id (invite_email_id); the Resend webhook
-- (POST /api/webhooks/resend) later reports the delivery outcome back and
-- updates invite_delivery_status. This lets the staff roster show a
-- "bounced"/"undeliverable" badge instead of a stale "Not Yet Invited" when
-- the address was wrong and the email never reached anyone.
--
-- invite_delivery_status values:
--   NULL         — no invite ever sent (matches invite_sent_at IS NULL)
--   'sent'       — handed to Resend, no delivery event yet
--   'delivered'  — Resend confirmed delivery
--   'bounced'    — hard/soft bounce, undeliverable
--   'complained' — recipient marked it as spam
--
-- The webhook routes an event to the right tenant by looping non-cancelled
-- companies and matching invite_email_id, so that column needs an index.
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS invite_email_id text;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS invite_delivery_status text;
-- Human-readable explanation of a delivery failure — a friendly reason plus
-- Resend's own diagnostic message — shown in the roster's failure tooltip.
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS invite_delivery_detail text;
CREATE INDEX IF NOT EXISTS idx_practitioners_invite_email_id ON practitioners (invite_email_id);
