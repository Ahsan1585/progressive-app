const crypto = require('crypto');
const { platformPool } = require('../config/platformDb');
const { generateSlots, isBookableSlot, SLOT_MINUTES, TZ } = require('../utils/demoSlots');
const { sendDemoBookingEmails, sendDemoBookingCancelledEmails } = require('../utils/emailClient');

// Public demo-call booking for the marketing site (izayaedge.com/eis/book).
// Lives in the platform database: a prospect belongs to no tenant yet.
//
// The platform database has no boot-time migration runner, so the table is
// created on first use (idempotent). The partial unique index is what makes
// double booking impossible: two people racing for the same slot both reach
// the INSERT, and the database rejects the second one (23505 -> 409).
// Mirrored in db/add_demo_bookings_platform.sql and db/platform-schema.sql.
const ENSURE_SQL = `
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
  CREATE UNIQUE INDEX IF NOT EXISTS demo_bookings_one_per_slot ON demo_bookings (slot_start) WHERE status = 'booked';
`;

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = platformPool.query(ENSURE_SQL).catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const cancelUrlFor = (token) => `${(process.env.MARKETING_SITE_URL || 'https://izayaedge.com/eis').replace(/\/$/, '')}/book?cancel=${token}`;

// GET /api/demo/slots
const getSlots = async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await platformPool.query(
      "SELECT slot_start FROM demo_bookings WHERE status = 'booked' AND slot_start >= now()"
    );
    const slots = generateSlots({ now: new Date(), days: 21, booked: rows.map((r) => r.slot_start) });
    res.json({ success: true, slots, timezone: TZ, slotMinutes: SLOT_MINUTES });
  } catch (err) {
    console.error('getSlots error:', err);
    res.status(500).json({ error: 'Could not load open times. Please try again.' });
  }
};

// POST /api/demo/bookings
const createBooking = async (req, res) => {
  const b = req.body || {};
  const fullName = clean(b.fullName, 120);
  const workEmail = clean(b.workEmail, 200).toLowerCase();
  const agencyName = clean(b.agencyName, 160);
  const message = clean(b.message, 2000) || null;
  const source = clean(b.source, 40) || null;
  const countRaw = parseInt(b.practitionerCount, 10);
  const practitionerCount = Number.isFinite(countRaw) && countRaw > 0 && countRaw < 10000 ? countRaw : null;
  const utm = b.utm && typeof b.utm === 'object' && !Array.isArray(b.utm)
    ? Object.fromEntries(Object.entries(b.utm).slice(0, 8).map(([k, v]) => [clean(k, 40), clean(v, 120)]))
    : null;

  if (!fullName || !workEmail || !agencyName) {
    return res.status(400).json({ error: 'Name, work email, and agency are required.' });
  }
  if (!EMAIL_RE.test(workEmail)) {
    return res.status(400).json({ error: 'Please enter a valid work email.' });
  }
  if (!isBookableSlot(b.slotStart, { now: new Date() })) {
    return res.status(400).json({ error: 'That time is not available. Please pick another.' });
  }

  const slotStart = new Date(b.slotStart);
  const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60 * 1000);
  const cancelToken = crypto.randomBytes(32).toString('hex');

  let booking;
  try {
    await ensureTable();
    const { rows } = await platformPool.query(
      `INSERT INTO demo_bookings (slot_start, slot_end, full_name, work_email, agency_name, practitioner_count, message, source, utm, cancel_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, slot_start, slot_end, cancel_token`,
      [slotStart.toISOString(), slotEnd.toISOString(), fullName, workEmail, agencyName, practitionerCount, message, source, utm ? JSON.stringify(utm) : null, cancelToken]
    );
    booking = rows[0];
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That time was just taken. Please pick another.' });
    }
    console.error('createBooking error:', err);
    return res.status(500).json({ error: 'Something went wrong booking your call. Please try again.' });
  }

  const meetingUrl = process.env.DEMO_MEETING_URL || null;
  // The booking already exists. An email problem is logged, never undone.
  try {
    await sendDemoBookingEmails({
      fullName, workEmail, agencyName, practitionerCount, message,
      slotStart: new Date(booking.slot_start), slotEnd: new Date(booking.slot_end),
      meetingUrl, cancelUrl: cancelUrlFor(booking.cancel_token), bookingId: booking.id,
    });
  } catch (err) {
    console.error('createBooking: confirmation email failed (booking kept):', err.message);
  }

  res.status(201).json({
    success: true,
    booking: {
      id: booking.id,
      slotStart: new Date(booking.slot_start).toISOString(),
      slotEnd: new Date(booking.slot_end).toISOString(),
      meetingUrl,
    },
  });
};

// POST /api/demo/bookings/cancel  { token }
const cancelBooking = async (req, res) => {
  const token = String(req.body?.token || '');
  if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'This cancel link is not valid.' });
  try {
    await ensureTable();
    const { rows } = await platformPool.query(
      `UPDATE demo_bookings SET status = 'cancelled', cancelled_at = now()
       WHERE cancel_token = $1 AND status = 'booked'
       RETURNING id, slot_start, slot_end, full_name, work_email, agency_name`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'This booking was already cancelled or could not be found.' });
    const r = rows[0];
    try {
      await sendDemoBookingCancelledEmails({
        fullName: r.full_name, workEmail: r.work_email, agencyName: r.agency_name,
        slotStart: new Date(r.slot_start), slotEnd: new Date(r.slot_end || new Date(r.slot_start).getTime() + SLOT_MINUTES * 60000), bookingId: r.id,
      });
    } catch (err) {
      console.error('cancelBooking: email failed (cancellation kept):', err.message);
    }
    res.json({ success: true, slotStart: new Date(r.slot_start).toISOString() });
  } catch (err) {
    console.error('cancelBooking error:', err);
    res.status(500).json({ error: 'Something went wrong cancelling. Please try again.' });
  }
};

// GET /api/platform/demo-bookings (platform admin)
const listDemoBookings = async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await platformPool.query(
      `SELECT id, slot_start, slot_end, full_name, work_email, agency_name, practitioner_count, message, source, utm, status, created_at, cancelled_at
       FROM demo_bookings ORDER BY slot_start DESC LIMIT 300`
    );
    res.json({ success: true, bookings: rows });
  } catch (err) {
    console.error('listDemoBookings error:', err);
    res.status(500).json({ error: 'Failed to load demo bookings' });
  }
};

module.exports = {
  getSlots, createBooking, cancelBooking, listDemoBookings,
  __resetTableReady: () => { tableReady = null; },
};
