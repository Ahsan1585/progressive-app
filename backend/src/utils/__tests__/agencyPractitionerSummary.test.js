// What an agency practitioner sees on their Home dashboard: where each of
// their session notes stands, what that is worth at their own pay rate, and
// which notes need them (returned) or are paused by the office (on hold).
const { summarizeAgencyNotes, bucketOf } = require('../agencyPractitionerSummary');

const TODAY = '2026-10-24';
let id = 0;
const note = (over = {}) => ({
  id: ++id,
  service_date: '2026-10-06',
  total_time: 60,
  billing_status: 'pending',
  billing_review: null,
  eims_missing_status: null,
  paid_at: null,
  patient_first_name: 'Leo',
  patient_last_name: 'Rivera',
  rejection_note: null,
  rejected_at: null,
  hold_note: null,
  held_at: null,
  ...over,
});
const sum = (o) => Object.values(o).reduce((n, b) => n + b.value, 0);

describe('bucketOf', () => {
  test('maps every billing state to one stage', () => {
    expect(bucketOf(note())).toBe('awaiting');
    expect(bucketOf(note({ billing_review: 'accept' }))).toBe('approved');
    expect(bucketOf(note({ billing_status: 'njeis_review' }))).toBe('invoiced');
    expect(bucketOf(note({ billing_status: 'invoiced' }))).toBe('invoiced');
    expect(bucketOf(note({ billing_status: 'completed', paid_at: '2026-10-20T10:00:00Z' }))).toBe('paid');
    expect(bucketOf(note({ billing_status: 'rejected' }))).toBe('returned');
    expect(bucketOf(note({ billing_status: 'on_hold' }))).toBe('onHold');
    expect(bucketOf(note({ billing_status: 'declined' }))).toBe('declined');
    expect(bucketOf(note({ billing_status: 'voided' }))).toBeNull();
  });

  test('paid only when the batch is marked paid, not merely invoiced', () => {
    expect(bucketOf(note({ billing_status: 'invoiced', paid_at: null }))).toBe('invoiced');
    expect(bucketOf(note({ billing_status: 'invoiced', paid_at: '2026-10-21T00:00:00Z' }))).toBe('paid');
  });

  test('a note sent to an admin as missing in EIMS is on hold (with admin)', () => {
    expect(bucketOf(note({ eims_missing_status: 'sent_to_admin' }))).toBe('onHold');
  });
});

describe('summarizeAgencyNotes', () => {
  const rows = [
    note({ total_time: 60 }), // awaiting $50
    note({ total_time: 30, billing_review: 'accept' }), // approved $25
    note({ total_time: 60, billing_status: 'invoiced' }), // invoiced unpaid $50
    note({ total_time: 120, billing_status: 'invoiced', paid_at: '2026-10-20T00:00:00Z' }), // paid $100
    note({ total_time: 45, billing_status: 'rejected', rejection_note: 'End time overlaps another session.\nPlease fix.', rejected_at: '2026-10-14T12:00:00Z' }), // returned $37.50
    note({ total_time: 60, billing_status: 'on_hold', hold_note: 'Waiting on IFSP confirmation.', held_at: '2026-10-20T12:00:00Z' }), // on hold $50
    note({ total_time: 90, billing_status: 'declined', rejection_note: 'Duplicate of an earlier entry.' }), // declined $75
    note({ total_time: 0, billing_status: 'pending' }), // cancelled visit, counts at $0
    // September: an open return from last month still needs fixing
    note({ service_date: '2026-09-28', total_time: 60, billing_status: 'rejected', rejection_note: 'Location does not match EIMS.', rejected_at: '2026-10-02T09:00:00Z' }),
    note({ service_date: '2026-09-10', total_time: 60, billing_status: 'invoiced', paid_at: null }), // owed from last month
  ];
  const s = summarizeAgencyNotes(rows, { payRate: 50, month: '2026-10', today: TODAY });

  test('the month breakdown always sums to Submitted', () => {
    expect(s.tiles.submitted.count).toBe(8);
    expect(s.tiles.submitted.value).toBeCloseTo(387.5);
    expect(sum(s.breakdown)).toBeCloseTo(s.tiles.submitted.value);
    expect(s.breakdown.returned).toEqual({ count: 1, value: 37.5 });
    expect(s.breakdown.onHold).toEqual({ count: 1, value: 50 });
    expect(s.breakdown.declined).toEqual({ count: 1, value: 75 });
    expect(s.breakdown.awaiting.count).toBe(2); // includes the 0-minute cancelled visit
  });

  test('Invoiced counts everything that reached an invoice; Paid only paid batches', () => {
    expect(s.tiles.invoiced).toEqual({ count: 2, value: 150 });
    expect(s.tiles.paid).toEqual({ count: 1, value: 100 });
  });

  test('Owed to you spans all months: in progress + invoiced-unpaid + on hold, never returned or declined', () => {
    // in progress 50 + 25 + 0, invoiced-unpaid 50 (Oct) + 50 (Sep), on hold 50
    expect(s.owed.inProgress).toBeCloseTo(75);
    expect(s.owed.invoicedUnpaid).toBeCloseTo(100);
    expect(s.owed.onHold).toBeCloseTo(50);
    expect(s.owed.value).toBeCloseTo(225);
  });

  test('money waiting on the practitioner\'s fix covers every open return, any month', () => {
    expect(s.waitingOnFix).toEqual({ count: 2, value: 87.5 });
  });

  test('Needs you lists open returns from any month, oldest first, with the office\'s reason and age', () => {
    expect(s.needsYou.returned.map((r) => r.serviceDate)).toEqual(['2026-09-28', '2026-10-06']);
    const [first, second] = s.needsYou.returned;
    expect(first.reason).toBe('Location does not match EIMS.');
    expect(first.daysAgo).toBe(22);
    expect(first.overdue).toBe(true); // more than 7 days since it came back
    expect(second.reason).toBe('End time overlaps another session.'); // first line only
    expect(second.daysAgo).toBe(10);
    expect(first.childName).toBe('Leo Rivera');
    expect(s.needsYou.onHold).toHaveLength(1);
    expect(s.needsYou.onHold[0]).toMatchObject({ reason: 'Waiting on IFSP confirmation.', daysAgo: 4, withAdmin: false, value: 50 });
  });

  test('declined notes are listed for the month with their reason, outside Owed', () => {
    expect(s.declined).toEqual([expect.objectContaining({ reason: 'Duplicate of an earlier entry.', value: 75 })]);
  });

  test('a resubmitted note (back to pending) is no longer returned', () => {
    const resubmitted = summarizeAgencyNotes([note({ billing_status: 'pending', rejection_note: 'old note', rejected_at: '2026-10-10T00:00:00Z' })], { payRate: 50, month: '2026-10', today: TODAY });
    expect(resubmitted.needsYou.returned).toHaveLength(0);
    expect(resubmitted.breakdown.awaiting.count).toBe(1);
  });

  test('with no pay rate on file, counts and hours still work and dollars are 0', () => {
    const z = summarizeAgencyNotes(rows, { payRate: 0, month: '2026-10', today: TODAY });
    expect(z.tiles.submitted.count).toBe(8);
    expect(z.tiles.submitted.hours).toBeCloseTo(7.75);
    expect(z.tiles.submitted.value).toBe(0);
    expect(z.hasPayRate).toBe(false);
  });

  test('trend covers the 6 months ending with the selected month', () => {
    expect(s.trend.map((t) => t.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    const oct = s.trend[5];
    expect(oct.submittedValue).toBeCloseTo(387.5);
    expect(oct.paidValue).toBeCloseTo(100);
    expect(oct.hours).toBeCloseTo(7.75);
    expect(s.trend[4].submittedValue).toBeCloseTo(100); // September
  });

  test("lists the month's notes with their stage, so a tapped stage can show them", () => {
    expect(s.monthNotes).toHaveLength(8);
    expect(s.monthNotes.filter((n) => n.stage === 'paid')).toEqual([expect.objectContaining({ childName: 'Leo Rivera', value: 100, minutes: 120, serviceDate: '2026-10-06' })]);
    expect(s.monthNotes.every((n) => n.serviceDate.startsWith('2026-10'))).toBe(true);
  });

  test('voided notes count for nothing', () => {
    const v = summarizeAgencyNotes([note({ billing_status: 'voided', total_time: 600 })], { payRate: 50, month: '2026-10', today: TODAY });
    expect(v.tiles.submitted.count).toBe(0);
    expect(v.owed.value).toBe(0);
  });
});
