-- Service Status becomes a built-in mapped/compared compliance field (same
-- tier as Service/Location/Group Size), replacing Logged Date in the
-- Company Information mapping screen. logged_date's column is left in
-- place (unused going forward) rather than dropped — purely additive.
ALTER TABLE compliance_state_logs ADD COLUMN IF NOT EXISTS service_status_label text;
