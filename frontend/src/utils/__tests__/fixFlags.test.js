// Run with: node --test src/utils/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagKind, buildFlagList, flagOutcome, nextOpenIndex, describeFlag, isFlaggedInQueue } from '../fixFlags.js';

const mismatch = { matched: true, flagged: true, fields: [
  { key: 'date', label: 'Service date', ours: '10/07', state: '10/07', match: true },
  { key: 'location', label: 'Location', ours: '1', state: '6', match: false },
] };
const clean = { matched: true, flagged: false, fields: [] };
const missing = { matched: false, flagged: false, fields: [] };
const duplicate = { matched: true, flagged: false, duplicateOfSessionId: 9, fields: [] };

test('flagKind tells a duplicate, a missing record and a field mismatch apart', () => {
  assert.equal(flagKind(mismatch), 'mismatch');
  assert.equal(flagKind(missing), 'missing');
  assert.equal(flagKind(duplicate), 'duplicate');
  assert.equal(flagKind({ ...missing, duplicateOfSessionId: 3 }), 'duplicate');
  assert.equal(flagKind(clean), null);
  assert.equal(flagKind(undefined), null);
});

test('buildFlagList keeps queue order and skips clean and already-billed sessions', () => {
  const sessions = [
    { id: 1, billing_status: 'pending' }, { id: 2, billing_status: 'pending' },
    { id: 3, billing_status: 'njeis_review' }, { id: 4, billing_status: 'on_hold' }, { id: 5, billing_status: 'pending' },
  ];
  const results = { 1: clean, 2: mismatch, 3: mismatch, 4: missing, 5: duplicate };
  assert.deepEqual(buildFlagList(sessions, results), [
    { id: 2, kind: 'mismatch' }, { id: 4, kind: 'missing' }, { id: 5, kind: 'duplicate' },
  ]);
});

test('flagOutcome reads the real billing status, so a handled flag stays handled after refresh', () => {
  assert.equal(flagOutcome({ id: 1, billing_status: 'pending' }, mismatch, {}), null);
  assert.equal(flagOutcome({ id: 1, billing_status: 'pending' }, mismatch, { 1: 'accept' }), 'approved');
  assert.equal(flagOutcome({ id: 1, billing_status: 'pending', billing_review: 'accept' }, mismatch, {}), 'approved');
  assert.equal(flagOutcome({ id: 1, billing_status: 'rejected' }, mismatch, {}), 'returned');
  assert.equal(flagOutcome({ id: 1, billing_status: 'declined' }, mismatch, {}), 'rejected');
  assert.equal(flagOutcome({ id: 1, billing_status: 'on_hold' }, mismatch, {}), 'held');
  assert.equal(flagOutcome({ id: 1, billing_status: 'pending' }, { ...missing, eimsMissingStatus: 'sent_to_admin' }, {}), 'with_admin');
  // A duplicate's stale Approved from before it was known to be a duplicate doesn't count.
  assert.equal(flagOutcome({ id: 1, billing_status: 'pending', billing_review: 'accept' }, duplicate, {}), null);
});

test('nextOpenIndex wraps around and returns -1 when everything is handled', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const done = new Set([2]);
  const handled = (f) => done.has(f.id);
  assert.equal(nextOpenIndex(list, 0, handled), 2);
  assert.equal(nextOpenIndex(list, 2, handled), 0);
  done.add(1); done.add(3);
  assert.equal(nextOpenIndex(list, 0, handled), -1);
});

test('describeFlag says what is wrong in plain words', () => {
  assert.deepEqual(describeFlag(mismatch), {
    title: "Location doesn't match EIMS",
    detail: 'Your log says 1. The EIMS record says 6.',
  });
  const two = { ...mismatch, fields: [...mismatch.fields, { key: 'end', label: 'End time', ours: '10:45', state: '10:30', match: false }] };
  assert.deepEqual(describeFlag(two), { title: "2 fields don't match EIMS", detail: 'Location and End time differ from the EIMS record.' });
  assert.equal(describeFlag(duplicate).title, 'Duplicate log');
  assert.match(describeFlag({ ...duplicate, duplicateOfInvoiced: true }).detail, /already invoiced/);
  assert.equal(describeFlag(missing).title, 'Missing in EIMS');
  assert.equal(describeFlag({ ...missing, missingReason: 'No record for this child on Oct 9.' }).detail, 'No record for this child on Oct 9.');
});

test('isFlaggedInQueue uses the saved flags, only while the session is still pending and not approved', () => {
  assert.equal(isFlaggedInQueue({ id: 1, billing_status: 'pending', eims_last_flagged: true }, {}), 'mismatch');
  assert.equal(isFlaggedInQueue({ id: 1, billing_status: 'pending', eims_last_missing: true }, {}), 'missing');
  assert.equal(isFlaggedInQueue({ id: 1, billing_status: 'pending', eims_last_flagged: true }, { 1: 'accept' }), null);
  assert.equal(isFlaggedInQueue({ id: 1, billing_status: 'on_hold', eims_last_flagged: true }, {}), null);
  assert.equal(isFlaggedInQueue({ id: 1, billing_status: 'pending' }, {}), null);
});

test('hasWordOverlap only treats values sharing a word as a plausible variant', async () => {
  const { hasWordOverlap } = await import('../fixFlags.js');
  assert.equal(hasWordOverlap('Direct Child Service', 'Make up Direct Child Service'), true);
  assert.equal(hasWordOverlap('Developmental Intervention', 'Speech Therapy'), false);
  assert.equal(hasWordOverlap('', 'Home'), false);
});

test('suggestNote writes the reason from the flag, worded for the action', async () => {
  const { suggestNote } = await import('../fixFlags.js');
  const session = { patient_first_name: 'gabriel', patient_last_name: 'chavez', service_date: '2026-10-07', start_time: '13:00:00' };

  const dupReturn = suggestNote('return', session, duplicate);
  assert.match(dupReturn, /duplicate/i);
  assert.match(dupReturn, /Gabriel Chavez on Oct 7 at 1:00 PM/);
  assert.match(dupReturn, /only one can be billed/i);
  assert.match(suggestNote('return', session, { ...duplicate, duplicateOfInvoiced: true }), /already invoiced/);
  assert.match(suggestNote('reject', session, duplicate), /^Rejected: duplicate/);
  assert.match(suggestNote('hold', session, duplicate), /^On hold: duplicate/);

  const twoOff = { ...mismatch, fields: [...mismatch.fields, { key: 'end_time', label: 'End time', ours: '10:45:00', state: '10:30:00', match: false }] };
  assert.equal(suggestNote('return', session, twoOff),
    "This log doesn't match the EIMS record for Gabriel Chavez on Oct 7:\n" +
    '- Location: your log says 1, EIMS says 6\n' +
    '- End time: your log says 10:45 AM, EIMS says 10:30 AM\n' +
    'Please correct the log and resubmit.');

  assert.match(suggestNote('return', session, missing), /No EIMS record was found for Gabriel Chavez on Oct 7 at 1:00 PM/);
  assert.match(suggestNote('hold', session, missing), /^On hold: no EIMS record/);
  assert.equal(suggestNote('return', session, clean), '');
});
