// Independent-practitioner-only: business-dashboard data for the mobile
// Home tab — "how many sessions have I submitted, what's their dollar
// value based on the invoices issued" (the user's own framing) plus
// supporting context (which agencies are the income source, how it trends
// month over month). Distinct from patientController.js's
// getPractitionerStats, which is a generic logging-activity tile shared by
// every role and has no dollar/billing concept at all.
//
// Dollar value is always hours × practitioners.pay_rate (the exact same
// math generateSelfCertifiedSEVF/generateInvoicePDF already use) — never
// stored directly anywhere (billing_batches has no amount column), so it's
// recomputed here from assessments.total_time each time. A 'voided'
// session (see patientController.js's voidCompletedLog) is excluded from
// every total/chart below — by explicit design, a rejected session counts
// for nothing, not even hours, once flagged.
const { pool } = require('../config/db');

async function getPayRate(practitionerId) {
  const { rows } = await pool.query('SELECT pay_rate FROM practitioners WHERE id = $1', [practitionerId]);
  const rate = parseFloat(rows[0]?.pay_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

// GET /api/practitioner-dashboard/summary — this month's $ invoiced (from
// 'completed' sessions), last month's $ invoiced for a simple trend delta,
// and $ pending (from EVERY still-'self_certified' session, regardless of
// its service_date — the same set Generate SEVF's "pending" list shows).
//
// pendingValue intentionally has no month boundary: a session logged 4
// months ago that's never been SEVF'd is exactly as "ready to invoice" as
// one logged yesterday, so scoping it to "this month" (as an earlier
// version of this endpoint did) silently hid real pending value and made
// the Home banner disagree with Generate SEVF's own pending list. Invoiced
// totals stay correctly month-scoped — "how much did I bill in month X" is
// a real per-month question in a way "how much is unbilled" isn't.
const getDashboardSummary = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const payRate = await getPayRate(practitionerId);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

    const [{ rows: recentRows }, { rows: pendingRows }] = await Promise.all([
      pool.query(
        `SELECT billing_status, total_time, service_date
         FROM assessments
         WHERE practitioner_id = $1 AND service_date >= $2 AND billing_status != 'voided'`,
        [practitionerId, lastMonthStart]
      ),
      pool.query(
        `SELECT total_time FROM assessments WHERE practitioner_id = $1 AND billing_status = 'self_certified'`,
        [practitionerId]
      ),
    ]);

    let invoicedThisMonth = 0, invoicedLastMonth = 0;
    let sessionsSubmittedThisMonth = 0, hoursThisMonth = 0;
    for (const r of recentRows) {
      const hours = (r.total_time || 0) / 60;
      const isThisMonth = r.service_date >= monthStart;
      if (r.billing_status === 'completed') {
        if (isThisMonth) {
          invoicedThisMonth += hours * payRate;
          sessionsSubmittedThisMonth += 1;
          hoursThisMonth += hours;
        } else {
          invoicedLastMonth += hours * payRate;
        }
      } else if (r.billing_status === 'self_certified' && isThisMonth) {
        sessionsSubmittedThisMonth += 1;
        hoursThisMonth += hours;
      }
    }

    let pendingValue = 0;
    for (const r of pendingRows) {
      pendingValue += ((r.total_time || 0) / 60) * payRate;
    }

    const percentChangeVsLastMonth = invoicedLastMonth > 0
      ? Math.round(((invoicedThisMonth - invoicedLastMonth) / invoicedLastMonth) * 100)
      : null; // No baseline to compare against — the UI shows no delta rather than a misleading 0%/infinite swing.

    res.json({
      success: true,
      sessionsSubmittedThisMonth,
      hoursThisMonth,
      invoicedThisMonth,
      pendingValue,
      percentChangeVsLastMonth,
    });
  } catch (error) {
    console.error('Error fetching practitioner dashboard summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard summary.' });
  }
};

// GET /api/practitioner-dashboard/monthly-trend — last 6 calendar months
// (oldest first), hours logged and $ invoiced per month, excluding
// 'voided' sessions throughout.
//
// The two figures intentionally track different things, same as the
// summary endpoint above: `hours` is every session logged that month
// regardless of billing status (completed OR still self_certified/
// pending — "how much did I work"), matching getDashboardSummary's own
// hoursThisMonth so the top stat tile and this chart's Hours view never
// disagree for the current month. `invoicedValue` stays strictly
// 'completed'-only — real invoiced money, not a projection off
// not-yet-billed hours.
const getMonthlyTrend = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const payRate = await getPayRate(practitionerId);
    const now = new Date();
    const sixMonthsAgoStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const sixMonthsAgoStartIso = `${sixMonthsAgoStart.getFullYear()}-${String(sixMonthsAgoStart.getMonth() + 1).padStart(2, '0')}-01`;

    const { rows } = await pool.query(
      `SELECT to_char(service_date, 'YYYY-MM') AS month,
              SUM(total_time) FILTER (WHERE billing_status != 'voided') AS all_minutes,
              SUM(total_time) FILTER (WHERE billing_status = 'completed') AS invoiced_minutes
       FROM assessments
       WHERE practitioner_id = $1 AND service_date >= $2
       GROUP BY to_char(service_date, 'YYYY-MM')`,
      [practitionerId, sixMonthsAgoStartIso]
    );
    const byMonth = new Map(rows.map((r) => [
      r.month,
      { allMinutes: parseFloat(r.all_minutes) || 0, invoicedMinutes: parseFloat(r.invoiced_minutes) || 0 },
    ]));

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const { allMinutes, invoicedMinutes } = byMonth.get(key) || { allMinutes: 0, invoicedMinutes: 0 };
      months.push({
        month: key,
        label: d.toLocaleDateString(undefined, { month: 'short' }),
        hours: allMinutes / 60,
        invoicedValue: (invoicedMinutes / 60) * payRate,
      });
    }

    res.json({ success: true, months });
  } catch (error) {
    console.error('Error fetching practitioner monthly trend:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch monthly trend.' });
  }
};

// GET /api/practitioner-dashboard/by-agency — this month's $ invoiced,
// broken down per agency (by assessments.company_affiliation, matched
// case-insensitively against the practitioner's saved agencies the same
// way resolveAgencyEmail does), sorted highest-value first. A session with
// no agency set (should be rare/non-existent for this role, since it's
// required at log time) groups under a literal "No agency" label rather
// than being silently dropped.
const getByAgency = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const payRate = await getPayRate(practitionerId);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { rows } = await pool.query(
      `SELECT company_affiliation, total_time
       FROM assessments
       WHERE practitioner_id = $1 AND billing_status = 'completed' AND service_date >= $2`,
      [practitionerId, monthStart]
    );

    const byAgency = new Map();
    for (const r of rows) {
      const name = r.company_affiliation || 'No agency';
      const hours = (r.total_time || 0) / 60;
      byAgency.set(name, (byAgency.get(name) || 0) + hours);
    }

    const agencies = Array.from(byAgency.entries())
      .map(([name, hours]) => ({ name, hours, invoicedValue: hours * payRate }))
      .sort((a, b) => b.invoicedValue - a.invoicedValue);

    res.json({ success: true, agencies });
  } catch (error) {
    console.error('Error fetching practitioner dashboard by-agency breakdown:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch agency breakdown.' });
  }
};

module.exports = { getDashboardSummary, getMonthlyTrend, getByAgency };
