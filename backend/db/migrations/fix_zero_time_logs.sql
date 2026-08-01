-- One-time data fix: the original "Session was cancelled — log with 0 time"
-- checkbox stored '00:00'/'00:00' for start_time/end_time, which rendered
-- as "12:00" in Compliance Analysis's "Our Log" column instead of blank
-- (the state's export has no time for a cancelled visit, so it shows "-").
-- The checkbox now submits blank times for new logs; this backfills every
-- log created under the old behavior. Idempotent: once a row's times are
-- NULL, the WHERE clause no longer matches it on a later boot.
UPDATE assessments
SET start_time = NULL, end_time = NULL
WHERE start_time = '00:00' AND end_time = '00:00' AND COALESCE(total_time, 0) = 0;
