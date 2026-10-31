// Company-wide operational dashboard — CEO/admin ("Overview" tab in
// AdminDashboard.jsx), distinct from practitionerDashboardController.js
// (which is scoped to one independent practitioner's own numbers). Every
// query here is tenant-scoped automatically via AsyncLocalStorage (see
// config/db.js) the same way every other controller is — no explicit
// tenant filter needed.
const { pool } = require('../config/db');
const { decryptField } = require('../utils/fieldEncryption');
const { computeSessionCompliance } = require('./billingController');
const { buildInvoiceLines, deriveEimsStatus, loadComplianceBatched, formatInvoiceNumber } = require('../utils/invoiceData');
// Read-only: viewing the dashboard must not mark pending sessions as checked.
const analyzeFn = (pid, start, end) => require('./billingController').runComplianceAnalysisForPractitioner(pid, start, end, { persist: false });
const { serviceCodeLabel, locationCodeLabel } = require('../constants/njeis');

// "What needs you" worklist — on_hold only. Returned (rejected) logs have
// their own dedicated "Returned logs" panel elsewhere on the dashboard;
// mixing them in here duplicated that list and muddied what this card is
// actually for (what's sitting in a billing specialist's hold queue).
const OPEN_EXCEPTION_STATUSES = ['on_hold'];

// The fixed set of individually reorderable/resizable Overview-dashboard
// cards. Each card can be shown full-width or half-width (two half-width
// cards sit side by side); a viewer's saved layout is an ARRAY of
// {key, width} in display order, not just a key order — width is part of
// the saved state, not inferred. Must exactly match the frontend's own
// DASHBOARD_CARD_KEYS constant in CompanyDashboard.jsx.
const DASHBOARD_CARD_KEYS = [
  'billing_pipeline',
  'action_queue',
  'services_breakdown',
  'documents_feed',
  'accuracy_table',
  'eims_status',
  'returned_logs',
  'trajectory_chart',
];
const DASHBOARD_CARD_WIDTHS = ['full', 'half'];

// Which slice of the EIMS match ring a session belongs to:
//   matched    EIMS verified it, an admin approved it, or it needs no check
//   missing    no EIMS record for it ("Missing"), including one already sent to
//              an admin for approval ("Awaiting"): still missing from EIMS
//   unverified it could not be checked (no state file uploaded)
//   flagged    everything else that needs a look: a field mismatch, a duplicate,
//              a rejection, or a human hold/return/decline (which always wins,
//              whatever EIMS says)
// Used by both the pipeline and the month overview so they cannot disagree.
const eimsBucket = (derived, humanHold) => {
  if (humanHold) return 'flagged';
  if (derived.tier === 'cleared') return 'matched';
  if (derived.label === 'Missing' || derived.label === 'Awaiting') return 'missing';
  if (derived.tier === 'unverified') return 'unverified';
  return 'flagged';
};

// A session still pending review, with its last Compliance Analysis verdict on
// file (eims_last_missing / eims_last_flagged, written by the bulk compliance
// runs). Billing's "N missing in EIMS" and "N not matching EIMS" badges count
// exactly these, so the ring does too. A pending session that was never checked
// (both columns null) is not counted either way: "not yet checked" is not
// evidence of anything. Same rule as the Practitioner accuracy table.
const pendingEimsBucket = (s) => {
  if (s.eims_last_missing) return 'missing';   // no EIMS record at all outranks a field mismatch
  if (s.eims_last_flagged) return 'flagged';
  return 'matched';                            // checked, and clean
};
const PENDING_CHECKED_SQL = `a.billing_status = 'pending'
         AND (a.eims_last_flagged IS NOT NULL OR a.eims_last_missing IS NOT NULL)`;

// Optional month scope (?month=YYYY-MM) for the cards below the stat row, so they
// follow the month picker exactly like the stat row does: by the session's
// service_date. Absent = no scope (all time), which the verdict banner relies
// on. Returns [start, end] as the two SQL params the filters below use; both
// null means "no filter". A malformed month falls back to the current month,
// the same as every other dashboard endpoint (parseMonthParam).
const monthScope = (req) => {
  const raw = req.query?.month;
  if (!raw) return [null, null];
  const { start, end } = parseMonthParam(raw);
  return [start, end];
};
// SQL for "this session is in the selected month (or no month was selected)",
// given the placeholder numbers of the start/end params and the column.
const inMonthSql = (startParam, endParam, column = 'service_date') =>
  `($${startParam}::date IS NULL OR (${column} >= $${startParam}::date AND ${column} <= $${endParam}::date))`;

// GET /api/dashboard/day — worklist, not a trend. "What needs a human
// today." With ?month=YYYY-MM the flagged list and its count cover only that
// month's sessions (the "What needs you" card); without it they are all-time
// (the verdict banner).
const getDayOverview = async (req, res) => {
  try {
    const [monthStart, monthEnd] = monthScope(req);
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
              a.practitioner_first_name, a.practitioner_last_name,
              a.total_time, p.pay_rate
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.billing_status = ANY($1::text[]) AND ${inMonthSql(2, 3, 'a.service_date')}
       ORDER BY COALESCE(a.held_at, a.rejected_at) ASC NULLS LAST
       LIMIT 200`,
      [OPEN_EXCEPTION_STATUSES, monthStart, monthEnd]
    );
    const { rows: exceptionCountRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM assessments WHERE billing_status = ANY($1::text[]) AND ${inMonthSql(2, 3)}`,
      [OPEN_EXCEPTION_STATUSES, monthStart, monthEnd]
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
        patientName: `${decryptField(r.patient_first_name) || ''} ${decryptField(r.patient_last_name) || ''}`.trim(),
        practitionerName: `${r.practitioner_first_name || ''} ${r.practitioner_last_name || ''}`.trim(),
        amount: Math.round((r.total_time ? r.total_time / 60 : 0) * parseFloat(r.pay_rate || 0) * 100) / 100,
      })),
      practitionersNoActivity7d: noActivityRows.map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}` })),
    });
  } catch (error) {
    console.error('getDayOverview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load day overview' });
  }
};

// GET /api/dashboard/returned-logs[?month=YYYY-MM] — list of logs billing has
// returned or declined (billing_status 'rejected'/'declined', set via
// rejectLog's type='return'/'reject'), oldest-first so the longest-waiting
// ones surface first, same convention as the day worklist's exception
// queue. Distinct from "What needs you" (which also includes on_hold):
// this view is specifically "what did we hand back to a practitioner,"
// with the full note/comment thread so the reason is visible inline.
const getReturnedLogs = async (req, res) => {
  try {
    const [monthStart, monthEnd] = monthScope(req);
    const { rows } = await pool.query(
      `SELECT a.id, a.billing_status, a.service_date, a.rejection_note, a.rejected_at, a.rejection_count,
              a.patient_first_name, a.patient_last_name,
              a.practitioner_first_name, a.practitioner_last_name,
              a.total_time, p.pay_rate
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.billing_status IN ('rejected', 'declined') AND ${inMonthSql(1, 2, 'a.service_date')}
       ORDER BY a.rejected_at ASC NULLS LAST
       LIMIT 200`,
      [monthStart, monthEnd]
    );
    const assessmentIds = rows.map((r) => r.id);
    const { rows: noteRows } = assessmentIds.length
      ? await pool.query(
          `SELECT assessment_id, author_role, note, created_at
           FROM assessment_notes
           WHERE assessment_id = ANY($1::int[])
           ORDER BY created_at ASC`,
          [assessmentIds]
        )
      : { rows: [] };
    const notesByAssessment = new Map();
    noteRows.forEach((n) => {
      if (!notesByAssessment.has(n.assessment_id)) notesByAssessment.set(n.assessment_id, []);
      notesByAssessment.get(n.assessment_id).push({ authorRole: n.author_role, note: n.note, createdAt: n.created_at });
    });

    res.json({
      success: true,
      count: rows.length,
      logs: rows.map((r) => ({
        id: r.id,
        status: r.billing_status,
        serviceDate: r.service_date,
        rejectedAt: r.rejected_at,
        rejectionCount: r.rejection_count,
        note: r.rejection_note || null,
        patientName: `${decryptField(r.patient_first_name) || ''} ${decryptField(r.patient_last_name) || ''}`.trim(),
        practitionerName: `${r.practitioner_first_name || ''} ${r.practitioner_last_name || ''}`.trim(),
        amount: Math.round((r.total_time ? r.total_time / 60 : 0) * parseFloat(r.pay_rate || 0) * 100) / 100,
        comments: notesByAssessment.get(r.id) || [],
      })),
    });
  } catch (error) {
    console.error('getReturnedLogs error:', error);
    res.status(500).json({ success: false, error: 'Failed to load returned logs' });
  }
};

// GET /api/dashboard/session-detail?assessmentId=123 — field-by-field
// "our log" vs "EIMS record" comparison for one session, so a flagged or
// returned row in the Overview dashboard can be inspected inline (a dialog)
// without navigating away to Billing & Invoices' Compliance Analysis tab.
// Reuses computeSessionCompliance directly — same comparison logic and
// field shape ({key, label, ours, state, match}) that tab already renders.
const getSessionDetail = async (req, res) => {
  const assessmentId = parseInt(req.query.assessmentId, 10);
  if (!assessmentId) return res.status(400).json({ success: false, error: 'assessmentId is required' });

  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.billing_status, a.service_date, a.hold_note, a.rejection_note, a.rejection_count,
              a.patient_first_name, a.patient_last_name,
              a.practitioner_id, a.practitioner_first_name, a.practitioner_last_name
       FROM assessments a WHERE a.id = $1`,
      [assessmentId]
    );
    const session = rows[0];
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    const compliance = await computeSessionCompliance(assessmentId);

    res.json({
      success: true,
      session: {
        id: session.id,
        status: session.billing_status,
        serviceDate: session.service_date,
        note: session.hold_note || session.rejection_note || null,
        rejectionCount: session.rejection_count,
        patientName: `${decryptField(session.patient_first_name) || ''} ${decryptField(session.patient_last_name) || ''}`.trim(),
        practitionerId: session.practitioner_id,
        practitionerName: `${session.practitioner_first_name || ''} ${session.practitioner_last_name || ''}`.trim(),
      },
      compliance,
    });
  } catch (error) {
    console.error('getSessionDetail error:', error);
    res.status(500).json({ success: false, error: 'Failed to load session detail' });
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

// GET /api/dashboard/pipeline[?month=YYYY-MM] — the CURRENT billing state of
// the sessions in the pipeline. The Overview passes the selected month so this
// card, the EIMS match chart and everything else below the stat row agree on
// which sessions they describe (service_date in that month). Without a month
// it is every session across all time.
const getPipelineOverview = async (req, res) => {
  try {
    const [monthStart, monthEnd] = monthScope(req);
    const { rows: statusRows } = await pool.query(
      `SELECT billing_status, COUNT(*)::int AS count FROM assessments
       WHERE ${inMonthSql(1, 2)}
       GROUP BY billing_status`,
      [monthStart, monthEnd]
    );
    const byStatus = { pending: 0, njeis_review: 0, invoiced: 0, self_certified: 0, completed: 0 };
    const exceptions = { on_hold: 0, rejected: 0, declined: 0, voided: 0 };
    statusRows.forEach((r) => {
      if (r.billing_status in byStatus) byStatus[r.billing_status] = r.count;
      else if (r.billing_status in exceptions) exceptions[r.billing_status] = r.count;
    });

    const totalInPipeline = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const invoicedTotal = byStatus.invoiced + byStatus.completed;
    // "Reviewed" must count every session that has passed the pending
    // stage, invoiced ones included (a session doesn't stop being
    // "reviewed" once it's also invoiced) — it's a cumulative funnel
    // stage, not a disjoint bucket. It also has to include on_hold/
    // rejected/declined: billing set those aside (or finally declined
    // them) only AFTER reviewing them, so leaving them out of this stage
    // hid the entire held-back/declined backlog from the funnel, making a
    // real held-or-declined tenant look like 100% of reviewed work sailed
    // straight through to Invoiced. (declined was missed in an earlier
    // pass of this same fix — same gap, one more status.)
    const reviewed = byStatus.njeis_review + invoicedTotal + exceptions.on_hold + exceptions.rejected + exceptions.declined;

    // Real "paid" count — billing_batches.paid_at is the authoritative
    // signal, same join the AP endpoint and getMonthOverview use.
    const { rows: paidRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM assessments a
       JOIN billing_batches bb ON bb.id = a.billing_batch_id
       WHERE a.billing_status IN ('invoiced', 'completed') AND bb.paid_at IS NOT NULL
         AND ${inMonthSql(1, 2, 'a.service_date')}`,
      [monthStart, monthEnd]
    );

    // All-time EIMS match status — unlike the month/year views, this runs
    // the real per-session compliance check (computeSessionCompliance),
    // not a cheap approximation, because a match rate that silently
    // undercounts "matched" isn't trustworthy. Capped to the most recent
    // 2000 billed sessions (most-recent-first) to keep the cost bounded
    // on a large all-time backlog while staying representative.
    //
    // Includes on_hold/rejected/declined — a session billing set aside
    // (or permanently declined) precisely because it DIDN'T clear EIMS is
    // the whole reason this chart exists; excluding any of them (as an
    // earlier pass of this fix still did for 'declined') silently hides
    // that session from the match rate and can show a false 100% even
    // with a real backlog of flagged/declined sessions in the queue.
    const { rows: billedSessions } = await pool.query(
      `SELECT a.id, a.billing_status, a.eims_missing_status, a.eims_entered_at, a.is_override, a.practitioner_id, a.total_time, a.service_date
       FROM assessments a
       WHERE a.billing_status IN ('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined')
         AND ${inMonthSql(1, 2, 'a.service_date')}
       ORDER BY a.service_date DESC
       LIMIT 2000`,
      [monthStart, monthEnd]
    );
    // Pending sessions with a stored compliance verdict (see pendingEimsBucket).
    const { rows: pendingCheckedSessions } = await pool.query(
      `SELECT a.practitioner_id, a.eims_last_flagged, a.eims_last_missing
       FROM assessments a
       WHERE ${PENDING_CHECKED_SQL}
         AND ${inMonthSql(1, 2, 'a.service_date')}`,
      [monthStart, monthEnd]
    );
    const { rows: practitionerRoleRows } = await pool.query(
      `SELECT id, role FROM practitioners WHERE id = ANY($1::int[])`,
      [[...new Set([...billedSessions, ...pendingCheckedSessions].map((s) => s.practitioner_id))]]
    );
    const roleById = new Map(practitionerRoleRows.map((r) => [r.id, r.role]));
    const complianceById = await loadComplianceBatched(
      billedSessions.filter((s) => roleById.get(s.practitioner_id) !== 'independent_practitioner'),
      analyzeFn,
      computeSessionCompliance
    );
    const eimsMatchRate = { matched: 0, flagged: 0, missing: 0, unverified: 0 };
    billedSessions.forEach((s) => {
      const mode = roleById.get(s.practitioner_id) === 'independent_practitioner' ? 'independent' : 'agency';
      const compliance = complianceById.get(s.id) || null;
      // Same override as getAccountsPayable: a human hold/return/decline
      // always counts as unresolved here, regardless of what the EIMS
      // tier alone would derive to.
      const humanHold = ['on_hold', 'rejected', 'declined'].includes(s.billing_status);
      const derived = humanHold ? { tier: 'exception' } : deriveEimsStatus(s, { mode, compliance });
      eimsMatchRate[eimsBucket(derived, humanHold)] += 1;
    });
    pendingCheckedSessions.forEach((s) => {
      // Independent practitioners self-report; their pending sessions are not cross-checked.
      if (roleById.get(s.practitioner_id) === 'independent_practitioner') return;
      eimsMatchRate[pendingEimsBucket(s)] += 1;
    });

    res.json({
      success: true,
      // Every session that entered the pipeline. Held, returned and declined
      // sessions were logged too (they are in 'reviewed' below), so they count
      // here: a funnel stage can never be smaller than the one after it.
      logged: totalInPipeline + exceptions.on_hold + exceptions.rejected + exceptions.declined,
      reviewed: Math.max(reviewed, 0),
      invoiced: invoicedTotal,
      paid: paidRows[0].count,
      exceptions,
      eimsMatchRate,
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
    // pending (njeis_review/invoiced/completed/self_certified/on_hold/
    // rejected/declined), reusing the same batched compliance loader (one analysis per practitioner-month)
    // concurrency pattern the invoice generator uses. Capped window (one
    // month), not all-time. on_hold/rejected/declined included (same fix
    // as getPipelineOverview/getAccountsPayable — declined was missed in
    // an earlier pass) so a held-back or declined session doesn't silently
    // vanish from the rate instead of counting against it — their tier is
    // force-set to 'exception' below regardless of what EIMS alone says,
    // since a human decision overrides that.
    const EXCEPTION_STATUSES = ['on_hold', 'rejected', 'declined'];
    const { rows: billedSessions } = await pool.query(
      `SELECT a.id, a.billing_status, a.eims_missing_status, a.eims_entered_at, a.is_override, a.practitioner_id, a.total_time, a.service_date
       FROM assessments a
       WHERE a.service_date >= $1 AND a.service_date <= $2
         AND a.billing_status IN ('njeis_review', 'invoiced', 'completed', 'self_certified', 'on_hold', 'rejected', 'declined')`,
      [start, end]
    );
    // Still-pending sessions that already have a real Compliance Analysis
    // verdict on file (persisted via persistEimsFlags — see its comment in
    // billingController.js) — folded into the accuracy table below so a
    // practitioner whose flagged/missing work hasn't been sent to billing
    // yet isn't silently absent from it, reading as a clean 100% by
    // omission instead of reflecting currently-open EIMS issues.
    const { rows: pendingCheckedSessions } = await pool.query(
      `SELECT a.practitioner_id, a.eims_last_flagged, a.eims_last_missing
       FROM assessments a
       WHERE a.service_date >= $1 AND a.service_date <= $2
         AND a.billing_status = 'pending'
         AND (a.eims_last_flagged IS NOT NULL OR a.eims_last_missing IS NOT NULL)`,
      [start, end]
    );
    const { rows: practitionerRoleRows } = await pool.query(
      `SELECT id, role, first_name, last_name, position_title FROM practitioners WHERE id = ANY($1::int[])`,
      [[...new Set([...billedSessions.map((s) => s.practitioner_id), ...pendingCheckedSessions.map((s) => s.practitioner_id)])]]
    );
    const roleById = new Map(practitionerRoleRows.map((r) => [r.id, r.role]));
    const complianceById = await loadComplianceBatched(
      billedSessions.filter((s) => roleById.get(s.practitioner_id) !== 'independent_practitioner'),
      analyzeFn,
      computeSessionCompliance
    );
    const eimsMatchRate = { matched: 0, flagged: 0, missing: 0, unverified: 0 };
    // Per-practitioner accuracy scorecard — same tier computation as the
    // aggregate rate above, just bucketed by practitioner_id too. "Clean"
    // means matched cleanly, EVERYTHING else (mismatch, missing, held,
    // returned, declined, unverified) counts against the score, since all
    // of those represent a log leadership had to question or chase down.
    const accuracyByPractitioner = new Map();
    billedSessions.forEach((s) => {
      const isIndependent = roleById.get(s.practitioner_id) === 'independent_practitioner';
      const mode = isIndependent ? 'independent' : 'agency';
      const compliance = complianceById.get(s.id) || null;
      const humanHold = EXCEPTION_STATUSES.includes(s.billing_status);
      const derived = humanHold ? { tier: 'exception' } : deriveEimsStatus(s, { mode, compliance });
      const tier = derived.tier;
      eimsMatchRate[eimsBucket(derived, humanHold)] += 1;

      // Independent practitioners self-report into EIMS — their "cleared"
      // tier means "said they entered it," not a real cross-referenced
      // match, so they're excluded from this scorecard entirely rather
      // than diluted into the same number as agency practitioners' actual
      // match rate.
      if (isIndependent) return;
      if (!accuracyByPractitioner.has(s.practitioner_id)) {
        accuracyByPractitioner.set(s.practitioner_id, { total: 0, clean: 0, held: 0 });
      }
      const acc = accuracyByPractitioner.get(s.practitioner_id);
      acc.total += 1;
      if (tier === 'cleared') acc.clean += 1;
      if (EXCEPTION_STATUSES.includes(s.billing_status)) acc.held += 1;
    });

    // A pending session that was never checked (both columns null) isn't
    // counted either way — "not yet checked" isn't evidence of accuracy
    // or inaccuracy.
    pendingCheckedSessions.forEach((s) => {
      if (roleById.get(s.practitioner_id) === 'independent_practitioner') return;
      eimsMatchRate[pendingEimsBucket(s)] += 1;
      if (!accuracyByPractitioner.has(s.practitioner_id)) {
        accuracyByPractitioner.set(s.practitioner_id, { total: 0, clean: 0, held: 0 });
      }
      const acc = accuracyByPractitioner.get(s.practitioner_id);
      acc.total += 1;
      if (!s.eims_last_flagged && !s.eims_last_missing) acc.clean += 1;
    });

    const practitionerAccuracy = [...accuracyByPractitioner.entries()].map(([practitionerId, acc]) => {
      const p = practitionerRoleRows.find((r) => r.id === practitionerId);
      return {
        practitionerId,
        name: p ? `${p.first_name} ${p.last_name}` : 'Unknown',
        discipline: p?.position_title || '',
        sessionsChecked: acc.total,
        cleanMatches: acc.clean,
        // heldOrReturned is only the on_hold/rejected/declined subset of
        // what's counting against the score — a still-pending session that's
        // flagged/mismatched or missing in EIMS also drags accuracyPct down
        // (see the comment above accuracyByPractitioner) without appearing
        // in that subset, so the two numbers didn't reconcile under
        // division. notClean is the true denominator-minus-clean count the
        // percentage is actually computed from.
        heldOrReturned: acc.held,
        notClean: acc.total - acc.clean,
        accuracyPct: acc.total > 0 ? Math.round((acc.clean / acc.total) * 1000) / 10 : null,
      };
    }).sort((a, b) => (a.accuracyPct ?? 101) - (b.accuracyPct ?? 101));

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

    // "Ready to pay" for this month — same clear-vs-held split as
    // getAccountsPayable, scoped to this month's service_date instead of
    // all-time, so the top stat row can show a month that isn't "right
    // now." Owed-but-unpaid (invoiced/completed not yet paid) plus
    // on_hold/rejected (held back, same as the all-time AP view), with
    // the same human-hold-overrides-EIMS-tier rule.
    const { rows: apSessions } = await pool.query(
      `SELECT a.id, a.total_time, a.billing_status, a.service_date,
              a.eims_missing_status, a.eims_entered_at, a.is_override, a.practitioner_id,
              p.pay_rate, p.role
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       LEFT JOIN billing_batches bb ON bb.id = a.billing_batch_id
       WHERE a.service_date >= $1 AND a.service_date <= $2
         AND (
           (a.billing_status IN ('invoiced', 'completed') AND bb.paid_at IS NULL)
           OR a.billing_status IN ('on_hold', 'rejected')
         )`,
      [start, end]
    );
    const apComplianceById = await loadComplianceBatched(
      apSessions.filter((s) => s.role !== 'independent_practitioner'),
      analyzeFn,
      computeSessionCompliance
    );
    let apTotalOwed = 0, apTotalClear = 0, apTotalHeld = 0;
    apSessions.forEach((s) => {
      const hours = s.total_time ? s.total_time / 60 : 0;
      const lineTotal = Math.round(hours * parseFloat(s.pay_rate || 0) * 100) / 100;
      const mode = s.role === 'independent_practitioner' ? 'independent' : 'agency';
      const compliance = apComplianceById.get(s.id) || null;
      const tier = (s.billing_status === 'on_hold' || s.billing_status === 'rejected')
        ? 'exception'
        : deriveEimsStatus(s, { mode, compliance }).tier;
      apTotalOwed += lineTotal;
      if (tier === 'cleared') apTotalClear += lineTotal;
      else apTotalHeld += lineTotal;
    });

    // This month's already-paid total — totalOwed above deliberately
    // excludes paid sessions, so a month that's mostly paid out has a
    // small totalOwed and the frontend can't tell "60% held back" means
    // 60% of a tiny remainder vs. 60% of the whole month. totalPaid lets
    // it show held-back against the month's real total billing instead.
    const { rows: paidTotalRows } = await pool.query(
      `SELECT COALESCE(SUM(ROUND((a.total_time / 60.0) * p.pay_rate, 2)), 0) AS total
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       JOIN billing_batches bb ON bb.id = a.billing_batch_id
       WHERE a.service_date >= $1 AND a.service_date <= $2
         AND a.billing_status IN ('invoiced', 'completed')
         AND bb.paid_at IS NOT NULL`,
      [start, end]
    );
    const apTotalPaid = Math.round(parseFloat(paidTotalRows[0].total) * 100) / 100;

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
      practitionerAccuracy,
      patientRosterCount: rosterRows[0].count,
      ap: {
        totalOwed: Math.round(apTotalOwed * 100) / 100,
        totalClear: Math.round(apTotalClear * 100) / 100,
        totalHeld: Math.round(apTotalHeld * 100) / 100,
        totalPaid: apTotalPaid,
      },
    });
  } catch (error) {
    console.error('getMonthOverview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load month overview' });
  }
};

// GET /api/dashboard/years — session totals for EVERY year that has sessions,
// oldest first, for the Overview's "Year" view (all years side by side). Not
// scoped to any month or year. Years with no sessions at all are simply absent;
// the front end fills the gaps between the first year and today.
const getYearsOverview = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT EXTRACT(YEAR FROM a.service_date)::int AS year, COUNT(*)::int AS count,
              COALESCE(SUM(a.total_time / 60.0 * p.pay_rate), 0)::numeric AS est_billable
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.service_date IS NOT NULL
       GROUP BY 1
       ORDER BY 1`
    );
    const years = rows.map((r) => ({
      year: r.year,
      count: r.count,
      estBillable: Math.round(parseFloat(r.est_billable) * 100) / 100,
    }));
    const { rows: rosterRows } = await pool.query(
      `SELECT COUNT(*)::int AS active_now FROM practitioners
       WHERE role = 'practitioner' AND is_active = true AND is_platform_support = false`
    );
    res.json({
      success: true,
      years,
      totalSessions: years.reduce((sum, y) => sum + y.count, 0),
      totalEstBillable: Math.round(years.reduce((sum, y) => sum + y.estBillable, 0) * 100) / 100,
      practitionerRoster: { activeNow: rosterRows[0]?.active_now ?? 0 },
    });
  } catch (error) {
    console.error('getYearsOverview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load all-years overview' });
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
    // ?month=YYYY-MM limits the money to that month's sessions (the verdict
    // banner follows the month picker); without it, everything unpaid.
    const [monthStart, monthEnd] = monthScope(req);
    // Includes on_hold/rejected, not just invoiced/completed — a session
    // billing set aside is still a session the practitioner performed and
    // is still owed for, it just isn't cleared to pay yet. Excluding it
    // (as an earlier version did) made "Ready to pay" show a false
    // 100% cleared / 0% held whenever the real holdback was sitting
    // entirely in on_hold/rejected logs that this query never looked at.
    const { rows: unpaidSessions } = await pool.query(
      `SELECT a.id, a.practitioner_id, a.service_date, a.total_time, a.billing_status,
              a.eims_missing_status, a.eims_entered_at, a.is_override,
              p.first_name, p.last_name, p.pay_rate, p.role
       FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       LEFT JOIN billing_batches bb ON bb.id = a.billing_batch_id
       WHERE (
         (a.billing_status IN ('invoiced', 'completed') AND bb.paid_at IS NULL)
         OR a.billing_status IN ('on_hold', 'rejected')
       ) AND ${inMonthSql(1, 2, 'a.service_date')}`,
      [monthStart, monthEnd]
    );

    if (unpaidSessions.length === 0) {
      return res.json({
        success: true,
        totalOwed: 0, totalClear: 0, totalHeld: 0,
        agingBuckets: [], perPractitionerTable: [],
      });
    }

    const complianceById = await loadComplianceBatched(
      unpaidSessions.filter((s) => s.role !== 'independent_practitioner'),
      analyzeFn,
      computeSessionCompliance
    );

    const lines = unpaidSessions.map((s) => {
      const hours = s.total_time ? s.total_time / 60 : 0;
      const lineTotal = Math.round(hours * parseFloat(s.pay_rate || 0) * 100) / 100;
      const mode = s.role === 'independent_practitioner' ? 'independent' : 'agency';
      const compliance = complianceById.get(s.id) || null;
      // A human explicitly set this log aside (on_hold/rejected) — that
      // overrides whatever EIMS tier the data would otherwise derive to.
      // Billing didn't flag it as "not safe to pay" because EIMS disagreed
      // necessarily; it could be a manual hold for any reason. Either way,
      // "held back by a human" must never show as "clear and safe to pay."
      const tier = (s.billing_status === 'on_hold' || s.billing_status === 'rejected')
        ? 'exception'
        : deriveEimsStatus(s, { mode, compliance }).tier;
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

const STATUS_BREAKDOWN_LABELS = {
  pending: 'Pending review',
  njeis_review: 'In EIMS review',
  invoiced: 'Invoiced',
  completed: 'Invoiced',
  self_certified: 'Self-certified',
  on_hold: 'On hold',
  rejected: 'Returned',
  declined: 'Returned',
  voided: 'Voided',
};

// Resolves raw {key, count} rows into labeled, sorted, top-6-plus-Other
// buckets — shared shape for all four Services-provided dimensions. A null
// key becomes an explicit "Not specified" bucket rather than being
// dropped, so the stacked bar's total always matches the month's real
// session count.
function bucketBreakdown(rows, keyField, labelFn) {
  const resolved = rows.map((r) => {
    const key = r[keyField];
    return {
      key,
      label: key == null ? 'Not specified' : labelFn(key),
      count: parseInt(r.count, 10),
    };
  });
  resolved.sort((a, b) => b.count - a.count);
  if (resolved.length <= 6) return resolved;
  const top6 = resolved.slice(0, 6);
  const otherCount = resolved.slice(6).reduce((sum, r) => sum + r.count, 0);
  return [...top6, { key: 'other', label: 'Other', count: otherCount }];
}

// GET /api/dashboard/services?month=YYYY-MM — this month's session counts
// broken down by service type / status / location / discipline, all four
// dimensions in one response so the frontend's tab switch is instant with
// no refetch. Discipline comes from practitioners.position_title (the
// actual discipline/title field), never service_types (billable service
// categories) — see Global Constraints.
const getServicesBreakdown = async (req, res) => {
  try {
    const { start, end } = parseMonthParam(req.query.month);

    const { rows: typeRows } = await pool.query(
      `SELECT type, COUNT(*)::int AS count FROM assessments
       WHERE service_date >= $1 AND service_date <= $2 GROUP BY type`,
      [start, end]
    );
    const { rows: statusRows } = await pool.query(
      `SELECT billing_status, COUNT(*)::int AS count FROM assessments
       WHERE service_date >= $1 AND service_date <= $2 GROUP BY billing_status`,
      [start, end]
    );
    const { rows: locationRows } = await pool.query(
      `SELECT location, COUNT(*)::int AS count FROM assessments
       WHERE service_date >= $1 AND service_date <= $2 GROUP BY location`,
      [start, end]
    );
    const { rows: disciplineRows } = await pool.query(
      `SELECT p.position_title, COUNT(*)::int AS count
       FROM assessments a JOIN practitioners p ON p.id = a.practitioner_id
       WHERE a.service_date >= $1 AND a.service_date <= $2 GROUP BY p.position_title`,
      [start, end]
    );

    res.json({
      success: true,
      month: req.query.month || null,
      byServiceType: bucketBreakdown(typeRows, 'type', serviceCodeLabel),
      byStatus: bucketBreakdown(statusRows, 'billing_status', (k) => STATUS_BREAKDOWN_LABELS[k] || k),
      byLocation: bucketBreakdown(locationRows, 'location', locationCodeLabel),
      byDiscipline: bucketBreakdown(disciplineRows, 'position_title', (k) => k),
    });
  } catch (error) {
    console.error('getServicesBreakdown error:', error);
    res.status(500).json({ success: false, error: 'Failed to load services breakdown' });
  }
};

// GET /api/dashboard/documents[?month=YYYY-MM] — billing_batches (latest 20, or the month's), each
// rolled up to one status: "worst wins" across its assessment lines (any
// genuine field-level mismatch -> mismatch; else anything else unresolved
// (exception/unverified) -> pending; else matched). No separate SEVF table
// exists in this schema — a batch for an independent_practitioner is
// simply labeled "sevf" instead of "invoice"; the document number format
// is identical either way (formatInvoiceNumber ties back to the same
// billing_batches row).
const getDocumentsFeed = async (req, res) => {
  try {
    // With ?month=YYYY-MM: the documents that cover at least one session from
    // that month (a billing batch is one practitioner's invoice/SEVF), up to
    // 50. Without a month: the 20 most recent, as before.
    const [monthStart, monthEnd] = monthScope(req);
    const limit = monthStart ? 50 : 20;
    const { rows: batches } = await pool.query(
      `SELECT bb.id, bb.created_at, bb.practitioner_id, p.first_name, p.last_name, p.role
       FROM billing_batches bb
       JOIN practitioners p ON p.id = bb.practitioner_id
       WHERE ($1::date IS NULL OR EXISTS (
         SELECT 1 FROM assessments x
         WHERE x.billing_batch_id = bb.id AND x.service_date >= $1::date AND x.service_date <= $2::date
       ))
       ORDER BY bb.created_at DESC
       LIMIT ${limit}`,
      [monthStart, monthEnd]
    );

    const documents = [];
    for (const batch of batches) {
      const { rows: lines } = await pool.query(
        `SELECT a.id, a.total_time, a.service_date, p.pay_rate, a.practitioner_id, p.role,
                a.eims_missing_status, a.eims_entered_at, a.is_override
         FROM assessments a JOIN practitioners p ON p.id = a.practitioner_id
         WHERE a.billing_batch_id = $1 AND a.billing_status != 'voided'`,
        [batch.id]
      );

      const sessionCount = lines.length;
      const amount = Math.round(
        lines.reduce((sum, l) => sum + (l.total_time ? l.total_time / 60 : 0) * parseFloat(l.pay_rate || 0), 0) * 100
      ) / 100;

      let status = 'pending';
      if (sessionCount > 0) {
        const complianceById = await loadComplianceBatched(
          lines.filter((l) => l.role !== 'independent_practitioner'),
          analyzeFn,
          computeSessionCompliance
        );
        const tiers = lines.map((l) => {
          const mode = l.role === 'independent_practitioner' ? 'independent' : 'agency';
          const compliance = complianceById.get(l.id) || null;
          return deriveEimsStatus(l, { mode, compliance }).tier;
        });
        // deriveEimsStatus's 'pending' tier is a genuine field-level
        // mismatch (compliance.matched && compliance.flagged — see
        // invoiceData.js), which is exactly what a billing-staff reader
        // means by "Mismatch" on this chip. Its 'exception' tier covers
        // missing/rejected/duplicate records — a record that isn't there
        // to compare at all is a different, still-open problem, not
        // (necessarily) a mismatched one, so it rolls up to this feed's
        // 'pending' chip instead of 'mismatch'.
        if (tiers.some((t) => t === 'pending')) status = 'mismatch';
        else if (tiers.every((t) => t === 'cleared')) status = 'matched';
        else status = 'pending';
      }

      documents.push({
        batchId: batch.id,
        documentNumber: formatInvoiceNumber(batch.id),
        documentType: batch.role === 'independent_practitioner' ? 'sevf' : 'invoice',
        practitionerName: `${batch.first_name} ${batch.last_name}`,
        sessionCount,
        amount,
        status,
        createdAt: batch.created_at,
      });
    }

    res.json({ success: true, documents });
  } catch (error) {
    console.error('getDocumentsFeed error:', error);
    res.status(500).json({ success: false, error: 'Failed to load documents feed' });
  }
};

// GET /api/dashboard/layout — the calling office-staff viewer's saved
// Overview section order, or null if they've never customized (frontend
// falls back to DASHBOARD_SECTION_KEYS's default order).
const getDashboardLayout = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT section_order FROM dashboard_layouts WHERE practitioner_id = $1',
      [req.practitioner.practitionerId]
    );
    res.json({ success: true, cardLayout: rows[0]?.section_order || null });
  } catch (error) {
    console.error('getDashboardLayout error:', error);
    res.status(500).json({ success: false, error: 'Failed to load dashboard layout' });
  }
};

// PUT /api/dashboard/layout — upserts the calling viewer's card layout: an
// array of {key, width} in display order. Validated server-side as an
// exact permutation of DASHBOARD_CARD_KEYS (no unknown/missing/duplicate
// keys) with each entry's width one of DASHBOARD_CARD_WIDTHS, rather than
// trusting the client's array blindly. Stored in the existing
// dashboard_layouts.section_order jsonb column — same column, new shape;
// no migration needed since jsonb doesn't enforce a schema.
const saveDashboardLayout = async (req, res) => {
  const { cardLayout } = req.body || {};
  const isValidLayout = Array.isArray(cardLayout)
    && cardLayout.length === DASHBOARD_CARD_KEYS.length
    && cardLayout.every((entry) => entry && typeof entry === 'object'
      && DASHBOARD_CARD_KEYS.includes(entry.key)
      && DASHBOARD_CARD_WIDTHS.includes(entry.width))
    && new Set(cardLayout.map((entry) => entry.key)).size === DASHBOARD_CARD_KEYS.length;
  if (!isValidLayout) {
    return res.status(400).json({ success: false, error: 'cardLayout must be a permutation of the known dashboard cards, each with a valid width' });
  }

  try {
    await pool.query(
      `INSERT INTO dashboard_layouts (practitioner_id, section_order, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (practitioner_id) DO UPDATE SET section_order = $2, updated_at = now()`,
      [req.practitioner.practitionerId, JSON.stringify(cardLayout)]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('saveDashboardLayout error:', error);
    res.status(500).json({ success: false, error: 'Failed to save dashboard layout' });
  }
};

module.exports = {
  getDayOverview,
  getPipelineOverview,
  getReturnedLogs,
  getSessionDetail,
  getMonthOverview,
  getYearOverview,
  getYearsOverview,
  eimsBucket,
  pendingEimsBucket,
  getAccountsPayable,
  getDashboardLayout,
  saveDashboardLayout,
  DASHBOARD_CARD_KEYS,
  DASHBOARD_CARD_WIDTHS,
  getServicesBreakdown,
  getDocumentsFeed,
};
