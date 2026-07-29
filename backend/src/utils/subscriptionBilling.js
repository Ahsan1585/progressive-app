const { pool } = require('../config/db');

// Calendar-month billing periods. `at` defaults to now — passed explicitly
// in tests/backfills to compute a past period.
function getPeriodBounds(at = new Date()) {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth(); // 0-indexed
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  const toISO = (d) => d.toISOString().slice(0, 10);
  return { periodStart: toISO(start), periodEnd: toISO(end) };
}

function nextBillingDate(at = new Date()) {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const next = new Date(Date.UTC(year, month + 1, 1));
  return next.toISOString().slice(0, 10);
}

// The calendar month immediately before `at`'s month — what the automatic
// billing run (scheduled for the 15th of each month) always closes out,
// regardless of what day it actually fires on.
function getPreviousPeriodBounds(at = new Date()) {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  return getPeriodBounds(new Date(Date.UTC(year, month - 1, 1)));
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
  getPractitionerActivity,
  getOfficeStaffCount,
  getSubscriptionSettings,
  computeCurrentPeriodSummary,
};
