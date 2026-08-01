-- One-time data fix for cancelled-visit logs whose start/end time was
-- manually forced to some matching placeholder (e.g. '00:00'/'00:00' from
-- the zero-time checkbox's original behavior, or '12:00'/'12:00' from
-- practitioners' own pre-existing workaround before that checkbox existed)
-- instead of being left blank. Compliance Analysis rendered that
-- placeholder literally ("12:00") in the Our Log column and flagged it
-- against the state's blank "-", even though the visit is legitimately
-- zero-duration. Scoped to the service-status codes that mean the visit
-- didn't happen (2 = Practitioner Cancelled, 3 = Family Cancelled,
-- 5 = Family Missed — see backend/db/migrations/add_dropdown_options.sql)
-- so a real, intentionally-identical start/end time on a normal service
-- record is never touched. Idempotent: once a row's times are NULL, the
-- WHERE clause no longer matches it on a later boot.
UPDATE assessments
SET start_time = NULL, end_time = NULL
WHERE start_time = end_time
  AND start_time IS NOT NULL
  AND COALESCE(total_time, 0) = 0
  AND status IN ('2', '3', '5');
