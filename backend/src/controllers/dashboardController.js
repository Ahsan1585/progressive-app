// Company-wide operational dashboard — CEO/admin ("Overview" tab in
// AdminDashboard.jsx), distinct from practitionerDashboardController.js
// (which is scoped to one independent practitioner's own numbers). Every
// query here is tenant-scoped automatically via AsyncLocalStorage (see
// config/db.js) the same way every other controller is — no explicit
// tenant filter needed.
const { pool } = require('../config/db');
const { computeSessionCompliance } = require('./billingController');
const { buildInvoiceLines, deriveEimsStatus, loadComplianceForLines } = require('../utils/invoiceData');

// Sessions logged today's "action needed" statuses — on_hold/rejected stay
// in the worklist regardless of service_date (they're open exceptions,
// not day-scoped), matching how Billing & Invoices itself treats them.
const OPEN_EXCEPTION_STATUSES = ['on_hold', 'rejected'];

// GET /api/dashboard/day — worklist, not a trend. "What needs a human
// today."
const getDayOverview = async (req, res) => {
  try {
    const { rows: todayRows } = await pool.query(
      `SELECT COUNT(*)::int AS count, COUNT(DISTINCT practitioner_id)::int AS practitioners
       FROM assessments WHERE completed_at::date = CURRENT_DATE`
    );

    // Oldest-first (ASC) — the queue's whole point is surfacing what's
    // been waiting longest, not what was most recently flagged.
    const { rows: exceptionRows } = await pool.query(
      `SELECT a.id, a.billing_status, a.service_date, a.hold_note, a.rejection_note,
              COALESCE(a.held_at, a.rejected_at) AS flagged_at,
              a.patient_first_name, a.patient_last_name,
              a.practitioner_first_name, a.practitioner_last_name
       FROM assessments a
       WHERE a.billing_status = ANY($1::text[])
       ORDER BY COALESCE(a.held_at, a.rejected_at) ASC NULLS LAST
       LIMIT 10`,
      [OPEN_EXCEPTION_STATUSES]
    );
    const { rows: exceptionCountRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM assessments WHERE billing_status = ANY($1::text[])`,
      [OPEN_EXCEPTION_STATUSES]
    );

    // Active practitioners with zero logged sessions in the last 7 days —
    // a light, honestly-computable "might need a check-in" signal. Not a
    // claim about scheduling gaps (this app has no scheduling data).
    const { rows: noActivityRows } = await pool.query(
      `SELECT p.id, p.first_name, p.last_name
       FROM practitioners p
       WHERE p.role = 'practitioner' AND p.is_active = true AND p.is_platform_support = false
         AND NOT EXISTS (
           SELECT 1 FROM assessments a
           WHERE a.practitioner_id = p.id AND a.completed_at >= now() - interval '7 days'
         )
       ORDER BY p.first_name, p.last_name
       LIMIT 20`
    );

    res.json({
      success: true,
      sessionsLoggedToday: todayRows[0].count,
      practitionersActiveToday: todayRows[0].practitioners,
      flaggedCount: exceptionCountRows[0].count,
      flaggedSessions: exceptionRows.map((r) => ({
        id: r.id,
        status: r.billing_status,
        serviceDate: r.service_date,
        flaggedAt: r.flagged_at,
        note: r.hold_note || r.rejection_note || null,
        patientName: `${r.patient_first_name || ''} ${r.patient_last_name || ''}`.trim(),
        practitionerName: `${r.practitioner_first_name || ''} ${r.practitioner_last_name || ''}`.trim(),
      })),
      practitionersNoActivity7d: noActivityRows.map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}` })),
    });
  } catch (error) {
    console.error('getDayOverview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load day overview' });
  }
};

function parseMonthParam(monthStr) {
  const now = new Date();
  const [yearStr, monthNumStr] = (monthStr || '').split('-');
  const year = parseInt(yearStr, 10) || now.getFullYear();
  const month = parseInt(monthNumStr, 10) || now.getMonth() + 1;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  return { year, month, start, end, daysInMonth };
}

function priorMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// GET /api/dashboard/pipeline — the CURRENT state of every session in the
// pipeline right now, across all time, not scoped to a calendar month.
// "How much work is sitting at each stage" is an operational backlog
// question, not a historical one — a session logged in August that's
// still pending review is just as real a bottleneck today as one logged
// yesterday, so this deliberately does NOT filter by service_date.
const getPipelineOverview = async (req, res) => {
  try {
    const { rows: statusRows } = await pool.query(
      `SELECT billing_status, COUNT(*)::int AS count FROM assessments GROUP BY billing_status`
    );
    const byStatus = { pending: 0, njeis_review: 0, invoiced: 0, self_certified: 0, completed: 0 };
    const exceptions = { on_hold: 0, rejected: 0, declined: 0, voided: 0 };
    statusRows.forEach((r) => {
      if (r.billing_status in byStatus) byStatus[r.billing_status] = r.count;
      else if (r.billing_status in exceptions) exceptions[r.billing_status] = r.count;
    });

    const totalInPipeline = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const reviewed = totalInPipeline - byStatus.pending - byStatus.self_certified;
    const invoicedTotal = byStatus.njeis_review + byStatus.invoiced + byStatus.completed;

    // Real "paid" count — billing_batches.paid_at is the authoritative
    // signal, same join the AP endpoint and getMonthOverview use.
    const { rows: paidRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM assessments a
       JOIN billing_batches bb ON bb.id = a.billing_batch_id
       WHERE a.billing_status IN ('invoiced', 'completed') AND bb.paid_at IS NOT NULL`
    );

    res.json({
      success: true,
      logged: totalInPipeline,
      reviewed: Math.max(reviewed, 0),
      invoiced: invoicedTotal,
      paid: paidRows[0].count,
      exceptions,
    });
  } catch (error) {
    console.error('getPipelineOverview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load pipeline overview' });
  }
};

// GET /api/dashboard/month?month=YYYY-MM — trend + status funnel +
// per-practitioner table for one calendar month.
const getMonthOverview = async (req, res) => {
  try {
    const { year, month, start, end } = parseMonthParam(req.query.month);
    const prior = priorMonth(year, month);
    const priorRange = parseMonthParam(`${prior.year}-${String(prior.month).padStart(2, '0')}`);

    const { rows: dailyRows } = await pool.query(
      `SELECT service_date::date AS date, COUNT(*)::int AS count,
              COALESCE(SUM(total_time), 0)::int AS minutes
       FROM assessments
       WHERE service_date >= $1 AND service_date <= $2
       GROUP BY service_date
       ORDER BY service_date`,
      [start, end]
    );

    const { rows: currentTotalRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM assessments WHERE service_date >= $1 AND service_date <= $2`,
      [start, end]
    );
    const { rows: priorTotalRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM assessments WHERE service_date >= $1 AND service_date <= $2`,
      [priorRange.start, priorRange.end]
    );
    const current = currentTotalRows[0].count;
    const priorCount = priorTotalRows[0].count;
    const pctChange = priorCount > 0 ? Math.round(((current - priorCount) / priorCount) * 1000) / 10 : null;

    const { rows: funnelRows } = await pool.query(
      `SELECT billing_status, COUNT(*)::int AS count
       FROM assessments
       WHERE service_date >= $1 AND service_date <= $2
       GROUP BY billing_status`,
      [start, end]
    );
    const funnel = { pending: 0, njeis_review: 0, invoiced: 0, self_certified: 0, completed: 0 };
    const exceptions = { on_hold: 0, rejected: 0, declined: 0, voided: 0 };
    funnelRows.forEach((r) => {
      if (r.billing_status in funnel) funnel[r.billing_status] = r.count;
      else if (r.billing_status in exceptions) exceptions[r.billing_status] = r.count;
    });

    // Real "paid" count for the funnel's 4th stage — invoiced/completed
    // only means "batched," not "actually paid" (billing_batches.paid_at
    // is the authoritative signal, same join the AP endpoint uses).
    const { rows: paidRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM assessments a
       JOIN billing_batches bb ON bb.id = a.billing_batch_id
       WHERE a.service_date >= $1 AND a.service_date <= $2
         AND a.billing_status IN ('invoiced', 'completed')
         AND bb.paid_at IS NOT NULL`,
      [start, end]
    );
    const paidCount = paidRows[0].count;

    // EIMS match rate for the month — bounded to sessions already past
    // pending (njeis_review/invoiced/completed/self_certified), reusing
    // the same loadComplianceForLines bounded-concurrency pattern the
    // invoice generator uses. Capped window (one month), not all-time.
    const { rows: billedSessions } = await pool.query(
      `SELECT a.id, a.eims_missing_status, a.eims_entered_at, a.is_override, a.practitioner_id
       FROM assessments a
       WHERE a.service_date >= $1 AND a.service_date <= $2
         AND a.billing_status IN ('njeis_review', 'invoiced', 'completed', 'self_certified')`,
      [start, end]
    );
    const { rows: practitionerRoleRows } = await pool.query(
      `SELECT id, role FROM practitioners WHERE id = ANY($1::int[])`,
      [[...new Set(billedSessions.map((s) => s.practitioner_id))]]
    );
    const roleById = new Map(practitionerRoleRows.map((r) => [r.id, r.role]));
    const complianceById = await loadComplianceForLines(
      billedSessions.filter((s) => roleById.get(s.practitioner_id) !== 'independent_practitioner').map((s) => s.id),
      computeSessionCompliance
    );
    const eimsMatchRate = { matched: 0, flagged: 0, missing: 0, unverified: 0 };
    billedSessions.forEach((s) => {
      const mode = roleById.get(s.practitioner_id) === 'independent_practitioner' ? 'independent' : 'agency';
      const compliance = complianceById.get(s.id) || null;
      const { tier } = deriveEimsStatus(s, { mode, compliance });
      if (tier === 'cleared') eimsMatchRate.matched += 1;
      else if (tier === 'pending') eimsMatchRate.flagged += 1;
      else if (tier === 'exception') eimsMatchRate.flagged += 1;
      else eimsMatchRate.unverified += 1;
    });

    const { rows: practitionerTableRows } = await pool.query(
      `SELECT a.practitioner_id, p.first_name, p.last_name, p.pay_rate,
              COUNT(*)::int AS sessions, COALESCE(SUM(a.total_time), 0)::int AS minutes
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.service_date >= $1 AND a.service_date <= $2
       GROUP BY a.practitioner_id, p.first_name, p.last_name, p.pay_rate
       ORDER BY sessions DESC`,
      [start, end]
    );
    const practitionerTable = practitionerTableRows.map((r) => ({
      practitionerId: r.practitioner_id,
      name: `${r.first_name} ${r.last_name}`,
      sessions: r.sessions,
      hours: Math.round((r.minutes / 60) * 100) / 100,
      estBillable: Math.round((r.minutes / 60) * parseFloat(r.pay_rate || 0) * 100) / 100,
    }));

    const { rows: rosterRows } = await pool.query(
      `SELECT COUNT(DISTINCT patient_id)::int AS count
       FROM assessments WHERE service_date >= $1 AND service_date <= $2`,
      [start, end]
    );

    res.json({
      success: true,
      year, month, start, end,
      dailyVolume: dailyRows.map((r) => ({
        date: r.date,
        count: r.count,
        hours: Math.round((r.minutes / 60) * 100) / 100,
      })),
      volumeVsPriorMonth: { current, prior: priorCount, pctChange },
      statusFunnel: funnel,
      paidCount,
      exceptions,
      eimsMatchRate,
      practitionerTable,
      patientRosterCount: rosterRows[0].count,
    });
  } catch (error) {
    console.error('getMonthOverview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load month overview' });
  }
};

// GET /api/dashboard/year?year=YYYY — strategic rollup, 12-month trend +
// YoY comparison + roster snapshot. Deliberately does NOT run
// computeSessionCompliance across a full year of sessions (too expensive
// — see plan's verification section); instead reports a coverage-style
// stat (how many of the year's billed sessions have ANY compliance_state_logs
// row at all for their service_date, a cheap EXISTS check) rather than a
// true matched/flagged/missing breakdown.
const getYearOverview = async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const priorStart = `${year - 1}-01-01`;
    const priorEnd = `${year - 1}-12-31`;

    const { rows: monthlyRows } = await pool.query(
      `SELECT date_trunc('month', service_date)::date AS month, COUNT(*)::int AS count,
              COALESCE(SUM(a.total_time), 0)::int AS minutes,
              COALESCE(SUM(a.total_time / 60.0 * p.pay_rate), 0)::numeric AS est_billable
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.service_date >= $1 AND a.service_date <= $2
       GROUP BY date_trunc('month', service_date)
       ORDER BY month`,
      [start, end]
    );
    const monthlyVolume = monthlyRows.map((r) => ({
      month: r.month,
      count: r.count,
      hours: Math.round((r.minutes / 60) * 100) / 100,
      estBillable: Math.round(parseFloat(r.est_billable) * 100) / 100,
    }));

    const { rows: currentYearRows } = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(a.total_time / 60.0 * p.pay_rate), 0)::numeric AS est_billable
       FROM assessments a JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.service_date >= $1 AND a.service_date <= $2`,
      [start, end]
    );
    const { rows: priorYearRows } = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(a.total_time / 60.0 * p.pay_rate), 0)::numeric AS est_billable
       FROM assessments a JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.service_date >= $1 AND a.service_date <= $2`,
      [priorStart, priorEnd]
    );
    const currentCount = currentYearRows[0].count;
    const priorCount = priorYearRows[0].count;
    const yoyComparison = {
      current: { count: currentCount, estBillable: Math.round(parseFloat(currentYearRows[0].est_billable) * 100) / 100 },
      prior: { count: priorCount, estBillable: Math.round(parseFloat(priorYearRows[0].est_billable) * 100) / 100 },
      pctChange: priorCount > 0 ? Math.round(((currentCount - priorCount) / priorCount) * 1000) / 10 : null,
    };

    // Coverage, not a true match rate — cheap EXISTS check against
    // compliance_state_logs for the session's own service_date, per the
    // function-level comment above.
    const { rows: coverageRows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM compliance_state_logs csl
             WHERE csl.service_date = a.service_date
           )
         )::int AS with_state_coverage
       FROM assessments a
       WHERE a.service_date >= $1 AND a.service_date <= $2
         AND a.billing_status IN ('njeis_review', 'invoiced', 'completed', 'self_certified')`,
      [start, end]
    );
    const coverageRate = coverageRows[0].total > 0
      ? Math.round((coverageRows[0].with_state_coverage / coverageRows[0].total) * 1000) / 10
      : null;

    const { rows: rosterRows } = await pool.query(
      `SELECT COUNT(*)::int AS active_now FROM practitioners
       WHERE role = 'practitioner' AND is_active = true AND is_platform_support = false`
    );
    const { rows: rosterStartRows } = await pool.query(
      `SELECT COUNT(*)::int AS active_at_year_start FROM practitioners
       WHERE role = 'practitioner' AND is_platform_support = false AND created_at < $1`,
      [start]
    );

    res.json({
      success: true,
      year,
      monthlyVolume,
      yoyComparison,
      fullYearCompliance: { coverageRate, totalBilledSessions: coverageRows[0].total },
      practitionerRoster: {
        activeNow: rosterRows[0].active_now,
        activeAtYearStart: rosterStartRows[0].active_at_year_start,
      },
    });
  } catch (error) {
    console.error('getYearOverview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load year overview' });
  }
};

// GET /api/dashboard/ap — accounts payable: money owed to practitioners
// for delivered sessions. "Owed" = billing_status in ('invoiced',
// 'completed') with no billing_batches.paid_at yet. Split into
// clear (safe to pay now, EIMS tier 'cleared') vs. held (earned but not
// yet verified) using the exact same deriveEimsStatus tier logic the
// invoice redesign already ships — a session the invoice would hold back
// from TOTAL DUE NOW is held here too, for the same reason.
const getAccountsPayable = async (req, res) => {
  try {
    const { rows: unpaidSessions } = await pool.query(
      `SELECT a.id, a.practitioner_id, a.service_date, a.total_time,
              a.eims_missing_status, a.eims_entered_at, a.is_override,
              p.first_name, p.last_name, p.pay_rate, p.role
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       LEFT JOIN billing_batches bb ON bb.id = a.billing_batch_id
       WHERE a.billing_status IN ('invoiced', 'completed')
         AND (bb.paid_at IS NULL)`
    );

    if (unpaidSessions.length === 0) {
      return res.json({
        success: true,
        totalOwed: 0, totalClear: 0, totalHeld: 0,
        agingBuckets: [], perPractitionerTable: [],
      });
    }

    const complianceById = await loadComplianceForLines(
      unpaidSessions.filter((s) => s.role !== 'independent_practitioner').map((s) => s.id),
      computeSessionCompliance
    );

    const lines = unpaidSessions.map((s) => {
      const hours = s.total_time ? s.total_time / 60 : 0;
      const lineTotal = Math.round(hours * parseFloat(s.pay_rate || 0) * 100) / 100;
      const mode = s.role === 'independent_practitioner' ? 'independent' : 'agency';
      const compliance = complianceById.get(s.id) || null;
      const { tier } = deriveEimsStatus(s, { mode, compliance });
      const ageDays = s.service_date ? Math.floor((Date.now() - new Date(s.service_date).getTime()) / 86400000) : 0;
      return {
        practitionerId: s.practitioner_id,
        practitionerName: `${s.first_name} ${s.last_name}`,
        lineTotal,
        tier,
        ageDays,
        serviceDate: s.service_date,
      };
    });

    const totalOwed = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
    const clearLines = lines.filter((l) => l.tier === 'cleared');
    const heldLines = lines.filter((l) => l.tier !== 'cleared');
    const totalClear = Math.round(clearLines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
    const totalHeld = Math.round(heldLines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;

    const bucketDefs = [
      { bucket: '0-7', min: 0, max: 7 },
      { bucket: '8-14', min: 8, max: 14 },
      { bucket: '15-30', min: 15, max: 30 },
      { bucket: '30+', min: 31, max: Infinity },
    ];
    const agingBuckets = bucketDefs.map(({ bucket, min, max }) => {
      const inBucket = lines.filter((l) => l.ageDays >= min && l.ageDays <= max);
      return {
        bucket,
        count: inBucket.length,
        amount: Math.round(inBucket.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100,
      };
    });

    const byPractitioner = new Map();
    lines.forEach((l) => {
      if (!byPractitioner.has(l.practitionerId)) {
        byPractitioner.set(l.practitionerId, {
          practitionerId: l.practitionerId,
          name: l.practitionerName,
          totalOwed: 0,
          clearAmount: 0,
          heldAmount: 0,
          oldestServiceDate: l.serviceDate,
        });
      }
      const row = byPractitioner.get(l.practitionerId);
      row.totalOwed += l.lineTotal;
      if (l.tier === 'cleared') row.clearAmount += l.lineTotal;
      else row.heldAmount += l.lineTotal;
      if (l.serviceDate && (!row.oldestServiceDate || l.serviceDate < row.oldestServiceDate)) {
        row.oldestServiceDate = l.serviceDate;
      }
    });
    const perPractitionerTable = Array.from(byPractitioner.values())
      .map((r) => ({
        ...r,
        totalOwed: Math.round(r.totalOwed * 100) / 100,
        clearAmount: Math.round(r.clearAmount * 100) / 100,
        heldAmount: Math.round(r.heldAmount * 100) / 100,
      }))
      // A $0 row (e.g. a cancelled/zero-duration session, or a $0 pay rate)
      // has nothing to act on — "who to prioritize in the next pay run"
      // shouldn't be cluttered by practitioners who are owed nothing.
      .filter((r) => r.totalOwed > 0)
      .sort((a, b) => b.totalOwed - a.totalOwed);

    res.json({ success: true, totalOwed, totalClear, totalHeld, agingBuckets, perPractitionerTable });
  } catch (error) {
    console.error('getAccountsPayable error:', error);
    res.status(500).json({ success: false, error: 'Failed to load accounts payable' });
  }
};

module.exports = {
  getDayOverview,
  getPipelineOverview,
  getMonthOverview,
  getYearOverview,
  getAccountsPayable,
};
