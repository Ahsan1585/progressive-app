-- backend/db/migrations/allow_two_session_drafts.sql
--
-- Raises the per-child draft cap from 1 to 2 — a practitioner can now keep
-- two independent in-progress logs open for the same child at once (e.g.
-- catching up on two separate missed visits). The old 1-per-(practitioner,
-- child) DB-level uniqueness no longer holds; sessionDraftsController.js's
-- saveDraft is now the sole enforcement point for the (now higher) cap.
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/allow_two_session_drafts.sql

ALTER TABLE session_drafts DROP CONSTRAINT IF EXISTS session_drafts_practitioner_patient_key;
