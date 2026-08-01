const { pool } = require('../config/db');

// The business runs on US Eastern time, but Cloud Run's clock is UTC — a
// raw `Date.getUTCMonth()` flips to the next month several hours before
// midnight actually arrives on the East Coast (e.g. July 31 8pm EDT is
// already August 1 midnight UTC). Every "what month is it" decision below
// must go through Eastern wall-clock time, not UTC, or billing periods and
// invoice dates roll over a day (sometimes a whole month) early.
function easternParts(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value])
  );
  return { year: Number(parts.year), month: Number(parts.month) - 1, day: Number(parts.day) };
}

// Bounds for an explicit (year, 0-indexed month) — built from Date.UTC purely
// as an ISO-date formatter, never re-derived through easternParts (doing so
// would shift a UTC-midnight-of-the-1st instant back into the prior day/month
// once converted to Eastern time).
function monthBounds(year, month) {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  const toISO = (d) => d.toISOString().slice(0, 10);
  return { periodStart: toISO(start), periodEnd: toISO(end) };
}

// Calendar-month billing periods. `at` defaults to now — passed explicitly
// in tests/backfills to compute a past period.
function getPeriodBounds(at = new Date()) {
  const { year, month } = easternParts(at);
  return monthBounds(year, month);
}

function nextBillingDate(at = new Date()) {
  const { year, month } = easternParts(at);
  const next = new Date(Date.UTC(year, month + 1, 1));
  return next.toISOString().slice(0, 10);
}

// The calendar month immediately before `at`'s month — what the automatic
// billing run (scheduled for the 15th of each month) always closes out,
// regardless of what day it actually fires on.
function getPreviousPeriodBounds(at = new Date()) {
  const { year, month } = easternParts(at);
  return monthBounds(year, month - 1);
}

// An invoice for a given period is due the 15th of the month right after
// that period ends (e.g. period_end 2026-06-30 -> due 2026-07-15) — the same
// date shown to the practitioner-facing admin as "due" and the date the
// automatic overdue sweep below compares against.
function invoiceDueDate(periodEnd) {
  const end = new Date(`${periodEnd}T12:00:00Z`);
  const due = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 15));
  return due.toISOString().slice(0, 10);
}

// Today's calendar date in Eastern time, as an ISO date string — used (not
// the server's raw UTC date) so the overdue sweep flips on the 16th by the
// business's own clock, not several hours early/late depending on DST.
function easternTodayIso(at = new Date()) {
  const { year, month, day } = easternParts(at);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

// The real lifecycle of a billed invoice: 'pending' when generated -> stays
// 'pending' (or 'failed', if a charge attempt errored) until either a
// payment succeeds ('paid') or the due date passes unpaid ('overdue'). This
// sweep is what actually performs that second transition — called lazily
// whenever invoices are read, so the status is always accurate regardless
// of whether any particular external cron job happens to have fired.
async function markOverdueInvoices(at = new Date()) {
  const today = easternTodayIso(at);
  const { rows } = await pool.query(
    `UPDATE subscription_invoices
     SET status = 'overdue'
     WHERE status IN ('pending', 'failed')
       AND (date_trunc('month', period_end) + interval '1 month' + interval '14 days')::date < $1::date
     RETURNING id`,
    [today]
  );
  return rows.length;
}

// A practitioner counts as active for the WHOLE period the moment they've
// submitted one session log in it — not prorated by log count, and status
// changes (deactivation) don't retroactively affect a period already
// underway. Mirrors the "How this charge is calculated" copy shown to admins.
async function getPractitionerActivity(periodStart, periodEnd) {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.first_name, p.last_name,
       COUNT(a.id) FILTER (WHERE a.service_date BETWEEN $1 AND $2) AS log_count
     FROM practitioners p
     LEFT JOIN assessments a ON a.practitioner_id = p.id
     WHERE p.role = 'practitioner'
     GROUP BY p.id, p.first_name, p.last_name
     ORDER BY log_count DESC, p.last_name ASC`,
    [periodStart, periodEnd]
  );
  return rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    logCount: Number(r.log_count),
    active: Number(r.log_count) > 0,
  }));
}

// Every non-practitioner role is an office/admin-portal seat for billing
// purposes — mirrors AdminDashboard.jsx's TAB_ACCESS role set.
async function getOfficeStaffCount() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM practitioners WHERE role != 'practitioner'`
  );
  return rows[0]?.count || 0;
}

async function getSubscriptionSettings() {
  const { rows } = await pool.query(
    `SELECT subscription_price_per_practitioner, subscription_included_staff_seats,
            subscription_extra_staff_seat_price, stripe_customer_id,
            stripe_default_payment_method_id, stripe_default_pm_type,
            stripe_default_pm_brand, stripe_default_pm_last4, stripe_default_pm_exp
     FROM company_settings WHERE id = 1`
  );
  const row = rows[0] || {};
  return {
    pricePerPractitioner: Number(row.subscription_price_per_practitioner ?? 18),
    includedStaffSeats: Number(row.subscription_included_staff_seats ?? 5),
    extraStaffSeatPrice: Number(row.subscription_extra_staff_seat_price ?? 5),
    stripeCustomerId: row.stripe_customer_id || null,
    defaultPaymentMethodId: row.stripe_default_payment_method_id || null,
    defaultPaymentMethodType: row.stripe_default_pm_type || null,
    defaultPaymentMethodBrand: row.stripe_default_pm_brand || null,
    defaultPaymentMethodLast4: row.stripe_default_pm_last4 || null,
    defaultPaymentMethodExp: row.stripe_default_pm_exp || null,
  };
}

// The full computed picture for "what would this period's invoice be right
// now" — used both by the live Summary/Next Charge view and as the exact
// inputs snapshotted into a subscription_invoices row when a period closes.
async function computeCurrentPeriodSummary(at = new Date()) {
  const { periodStart, periodEnd } = getPeriodBounds(at);
  const settings = await getSubscriptionSettings();

  const [practitioners, officeStaffCount, totalPractitionerCount] = await Promise.all([
    getPractitionerActivity(periodStart, periodEnd),
    getOfficeStaffCount(),
    pool.query(`SELECT COUNT(*)::int AS count FROM practitioners WHERE role = 'practitioner'`).then((r) => r.rows[0]?.count || 0),
  ]);

  const activePractitioners = practitioners.filter((p) => p.active);
  const practitionerCharge = round2(activePractitioners.length * settings.pricePerPractitioner);

  const extraStaffSeats = Math.max(0, officeStaffCount - settings.includedStaffSeats);
  const extraStaffCharge = round2(extraStaffSeats * settings.extraStaffSeatPrice);

  const totalAmount = round2(practitionerCharge + extraStaffCharge);

  return {
    periodStart,
    periodEnd,
    nextBillingDate: nextBillingDate(at),
    pricePerPractitioner: settings.pricePerPractitioner,
    includedStaffSeats: settings.includedStaffSeats,
    extraStaffSeatPrice: settings.extraStaffSeatPrice,
    practitioners,
    activePractitionerCount: activePractitioners.length,
    totalPractitionerCount,
    practitionerCharge,
    officeStaffCount,
    extraStaffSeats,
    extraStaffCharge,
    totalAmount,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  getPeriodBounds,
  getPreviousPeriodBounds,
  nextBillingDate,
  invoiceDueDate,
  markOverdueInvoices,
  getPractitionerActivity,
  getOfficeStaffCount,
  getSubscriptionSettings,
  computeCurrentPeriodSummary,
};
