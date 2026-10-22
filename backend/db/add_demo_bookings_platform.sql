-- Demo-call bookings from the marketing site (izayaedge.com/eis/book).
-- The running app also creates this on first use (demoBookingController.js,
-- ENSURE_SQL), so applying it by hand is optional. Safe to re-run.
-- Apply with: psql "<connection string, connected to izaya_platform>" -f backend/db/add_demo_bookings_platform.sql
CREATE TABLE IF NOT EXISTS demo_bookings (
  id serial PRIMARY KEY,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  full_name text NOT NULL,
  work_email text NOT NULL,
  agency_name text NOT NULL,
  practitioner_count integer,
  message text,
  source text,
  utm jsonb,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  cancel_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
-- One live booking per slot: the database itself blocks double booking.
CREATE UNIQUE INDEX IF NOT EXISTS demo_bookings_one_per_slot ON demo_bookings (slot_start) WHERE status = 'booked';
