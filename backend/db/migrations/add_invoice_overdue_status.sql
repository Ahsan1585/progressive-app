-- Adds 'overdue' as a real, persisted lifecycle status for subscription
-- invoices (previously only computed client-side from period_end + 15 days,
-- never stored). Lifecycle: 'pending' when generated -> 'overdue' once the
-- 15th-of-next-month due date passes unpaid -> 'paid' once a charge
-- succeeds (or 'failed' if a charge attempt errors out, which can still
-- later flip to 'overdue' the same way 'pending' does).
--
-- Apply with: psql "<connection string>" -f backend/db/migrations/add_invoice_overdue_status.sql

ALTER TABLE subscription_invoices DROP CONSTRAINT IF EXISTS subscription_invoices_status_check;
ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'overdue'::text, 'paid'::text, 'failed'::text, 'void'::text]));
