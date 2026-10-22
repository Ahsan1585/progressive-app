// The dashboard needs EIMS verdicts for thousands of sessions. One analysis call
// per practitioner-month must answer them, instead of several queries per session.
const { loadComplianceBatched } = require('../invoiceData');

const sessions = [
  { id: 1, practitioner_id: 7, service_date: '2026-02-03' },
  { id: 2, practitioner_id: 7, service_date: '2026-02-20' },
  { id: 3, practitioner_id: 7, service_date: '2026-03-02' },
  { id: 4, practitioner_id: 8, service_date: '2026-02-03' },
];

test('one analysis per practitioner and month, not one lookup per session', async () => {
  const analyze = jest.fn(async (pid) => ({ documentOnFile: true, results: { 1: { matched: true, flagged: false }, 2: { matched: true, flagged: true }, 3: { matched: false, flagged: false }, 4: { matched: true, flagged: false } } }));
  const compute = jest.fn();
  const out = await loadComplianceBatched(sessions, analyze, compute);
  expect(analyze).toHaveBeenCalledTimes(3);
  expect(analyze).toHaveBeenCalledWith(7, '2026-02-01', '2026-02-28');
  expect(compute).not.toHaveBeenCalled();
  expect(out.get(2)).toMatchObject({ matched: true, flagged: true, documentOnFile: true });
});

test('a session the batch did not cover falls back to the single check', async () => {
  const analyze = jest.fn(async () => ({ documentOnFile: true, results: {} }));
  const compute = jest.fn(async (id) => ({ matched: true, flagged: false, documentOnFile: true, id }));
  const out = await loadComplianceBatched([sessions[0]], analyze, compute);
  expect(compute).toHaveBeenCalledWith(1);
  expect(out.get(1).matched).toBe(true);
});

test('no document on file is reported as not verified, not as an error', async () => {
  const analyze = jest.fn(async () => ({ documentOnFile: false }));
  const out = await loadComplianceBatched([sessions[0]], analyze, jest.fn());
  expect(out.get(1)).toMatchObject({ matched: false, documentOnFile: false });
});

test('a failing analysis does not lose the line: it falls back', async () => {
  const analyze = jest.fn(async () => { throw new Error('boom'); });
  const compute = jest.fn(async () => ({ matched: true, flagged: false, documentOnFile: true }));
  const out = await loadComplianceBatched([sessions[0]], analyze, compute);
  expect(out.get(1).matched).toBe(true);
});
