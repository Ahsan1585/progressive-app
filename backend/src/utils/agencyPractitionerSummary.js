// Agency practitioner's Home dashboard: where each of their session notes
// stands, what it is worth at their own pay rate (hours x pay_rate, the same
// figure as the invoice their agency generates for them), and which notes need
// them (returned) or are paused by the office (on hold).
//
// Pure function over the practitioner's own assessment rows, so the rules are
// testable without a database. Rows need: id, service_date (YYYY-MM-DD),
// total_time (minutes), billing_status, billing_review, eims_missing_status,
// paid_at (from billing_batches), patient_first_name, patient_last_name,
// rejection_note, rejected_at, hold_note, held_at.

const STAGES = ['awaiting', 'approved', 'invoiced', 'paid', 'returned', 'onHold', 'declined'];
const INVOICED_STATUSES = new Set(['njeis_review', 'invoiced', 'completed']);
const OVERDUE_DAYS = 7;

// The one stage a note is in right now (null = voided, counts for nothing).
function bucketOf(row) {
  const status = row.billing_status;
  if (status === 'voided') return null;
  if (status === 'declined') return 'declined';
  if (status === 'rejected') return 'returned';
  if (status === 'on_hold') return 'onHold';
  if (INVOICED_STATUSES.has(status)) return row.paid_at ? 'paid' : 'invoiced';
  // escalated to an admin as missing in EIMS: the office's move, shown as on hold
  if (row.eims_missing_status === 'sent_to_admin') return 'onHold';
  if (row.billing_review === 'accept') return 'approved';
  return 'awaiting';
}

const round2 = (n) => Math.round(n * 100) / 100;
const firstLine = (text) => String(text || '').split(/\r?\n/)[0].trim() || null;
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));
const daysBetween = (fromIso, toIso) => {
  if (!fromIso) return null;
  const a = Date.UTC(...dateOnly(fromIso).split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  const b = Date.UTC(...dateOnly(toIso).split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  return Math.max(0, Math.round((b - a) / 86400000));
};
const monthOf = (row) => dateOnly(row.service_date).slice(0, 7);
const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function summarizeAgencyNotes(rows, { payRate = 0, month, today }) {
  const rate = Number.isFinite(payRate) && payRate > 0 ? payRate : 0;
  const hoursOf = (r) => (Number(r.total_time) || 0) / 60;
  const valueOf = (r) => round2(hoursOf(r) * rate);

  const live = [];
  for (const r of rows) {
    const stage = bucketOf(r);
    if (stage) live.push({ ...r, stage, value: valueOf(r), hours: hoursOf(r), month: monthOf(r) });
  }

  // ---- the selected month
  const inMonth = live.filter((r) => r.month === month);
  const breakdown = Object.fromEntries(STAGES.map((k) => [k, { count: 0, value: 0 }]));
  for (const r of inMonth) {
    breakdown[r.stage].count += 1;
    breakdown[r.stage].value = round2(breakdown[r.stage].value + r.value);
  }
  const submitted = {
    count: inMonth.length,
    value: round2(inMonth.reduce((n, r) => n + r.value, 0)),
    hours: round2(inMonth.reduce((n, r) => n + r.hours, 0)),
  };
  const tiles = {
    submitted,
    invoiced: { count: breakdown.invoiced.count + breakdown.paid.count, value: round2(breakdown.invoiced.value + breakdown.paid.value) },
    paid: { ...breakdown.paid },
  };

  // ---- across all months
  const sumStage = (stages) => round2(live.filter((r) => stages.includes(r.stage)).reduce((n, r) => n + r.value, 0));
  const owed = {
    inProgress: sumStage(['awaiting', 'approved']),
    invoicedUnpaid: sumStage(['invoiced']),
    onHold: sumStage(['onHold']),
  };
  owed.value = round2(owed.inProgress + owed.invoicedUnpaid + owed.onHold);

  const item = (r, reason, since) => {
    const daysAgo = daysBetween(since, today);
    return {
      id: r.id,
      childName: `${r.patient_first_name || ''} ${r.patient_last_name || ''}`.trim(),
      serviceDate: dateOnly(r.service_date),
      reason: firstLine(reason),
      since: since ? dateOnly(since) : null,
      daysAgo,
      overdue: daysAgo !== null && daysAgo > OVERDUE_DAYS,
      value: r.value,
      minutes: Number(r.total_time) || 0,
    };
  };
  const bySince = (a, b) => (a.since || a.serviceDate).localeCompare(b.since || b.serviceDate);
  const returned = live.filter((r) => r.stage === 'returned').map((r) => item(r, r.rejection_note, r.rejected_at)).sort(bySince);
  const onHold = live.filter((r) => r.stage === 'onHold').map((r) => ({
    ...item(r, r.hold_note, r.held_at),
    withAdmin: r.billing_status !== 'on_hold' && r.eims_missing_status === 'sent_to_admin',
  })).sort(bySince);
  const waitingOnFix = { count: returned.length, value: round2(returned.reduce((n, r) => n + r.value, 0)) };

  const declined = inMonth.filter((r) => r.stage === 'declined').map((r) => item(r, r.rejection_note, r.rejected_at));
  // every note in the month with its stage, oldest first, for the tappable progress stages
  const monthNotes = inMonth
    .map((r) => ({ id: r.id, stage: r.stage, childName: `${r.patient_first_name || ''} ${r.patient_last_name || ''}`.trim(), serviceDate: dateOnly(r.service_date), value: r.value, minutes: Number(r.total_time) || 0 }))
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.id - b.id);

  // ---- six months ending with the selected one
  const trend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const m = shiftMonth(month, -i);
    const ms = live.filter((r) => r.month === m);
    trend.push({
      month: m,
      label: MONTH_LABELS[Number(m.slice(5, 7)) - 1],
      submittedValue: round2(ms.reduce((n, r) => n + r.value, 0)),
      paidValue: round2(ms.filter((r) => r.stage === 'paid').reduce((n, r) => n + r.value, 0)),
      hours: round2(ms.reduce((n, r) => n + r.hours, 0)),
    });
  }

  return {
    month,
    hasPayRate: rate > 0,
    tiles,
    breakdown,
    owed,
    waitingOnFix,
    needsYou: { returned, onHold },
    declined,
    monthNotes,
    trend,
  };
}

module.exports = { summarizeAgencyNotes, bucketOf, STAGES };
