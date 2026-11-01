// Integration-style check (real deriveEimsStatus + real eimsBucket, not
// mocked) that a session approved via Compliance Analysis's "Approve
// anyway" — which Allow-acknowledges every flagged field, same shape
// buildFieldsForSession produces — genuinely routes to the EIMS donut's
// "Billed, unresolved mismatch" bucket once billed, not silently absorbed
// into Matched. A mocked deriveEimsStatus in the other dashboard test
// files can't catch a regression in the real function's own logic; this
// is the test that would have caught today's real production gap.
const { deriveEimsStatus } = require('../../utils/invoiceData');
const { eimsBucket } = require('../dashboardController');

describe('deriveEimsStatus + eimsBucket together: Allow-bypassed sessions', () => {
  test('a single-field Allow click (the rest of the fields genuinely match) still routes to billedUnresolved once billed', () => {
    const compliance = {
      matched: true, flagged: false, documentOnFile: true,
      fields: [
        { key: 'start_time', match: true },
        { key: 'location', match: true, acknowledged: true }, // Allow-bypassed, not a real match
      ],
    };
    const derived = deriveEimsStatus({ total_time: 60 }, { mode: 'agency', compliance });
    expect(derived).toMatchObject({ tier: 'cleared', label: 'Matched', hasOverride: false });
    expect(eimsBucket(derived, false, true)).toBe('billedUnresolved');
    expect(eimsBucket(derived, false, false)).toBe('matched'); // not yet billed: no bucket penalty
  });

  test('"Approve anyway" (every flagged field Allow-acknowledged in one action) also routes to billedUnresolved once billed', () => {
    const compliance = {
      matched: true, flagged: false, documentOnFile: true,
      fields: [
        { key: 'start_time', match: true, acknowledged: true },
        { key: 'location', match: true, acknowledged: true },
        { key: 'end_time', match: true, acknowledged: true },
      ],
    };
    const derived = deriveEimsStatus({ total_time: 60 }, { mode: 'agency', compliance });
    expect(derived).toMatchObject({ tier: 'cleared', label: 'Matched', hasOverride: false });
    expect(eimsBucket(derived, false, true)).toBe('billedUnresolved');
  });

  test('a session that genuinely, naturally matches EIMS (nothing ever disagreed) stays Matched once billed', () => {
    const compliance = { matched: true, flagged: false, documentOnFile: true, fields: [{ key: 'start_time', match: true }] };
    const derived = deriveEimsStatus({ total_time: 60 }, { mode: 'agency', compliance });
    expect(derived).toMatchObject({ tier: 'cleared', label: 'Matched', hasOverride: false });
    expect(eimsBucket(derived, false, true)).toBe('matched');
  });

  test('a learned-match rule (a human taught a real labeling variant once; it auto-resolves from then on) still counts as resolved', () => {
    const compliance = { matched: true, flagged: false, documentOnFile: true, fields: [{ key: 'service_type', match: true, learnedMatch: true }] };
    const derived = deriveEimsStatus({ total_time: 60 }, { mode: 'agency', compliance });
    expect(derived).toMatchObject({ tier: 'cleared', label: 'Exception', hasOverride: true });
    expect(eimsBucket(derived, false, true)).toBe('matched');
  });

  test('a session still showing a genuine, un-addressed mismatch (no Allow at all) routes to billedUnresolved once billed', () => {
    const compliance = { matched: true, flagged: true, documentOnFile: true, fields: [{ key: 'location', match: false }] };
    const derived = deriveEimsStatus({ total_time: 60 }, { mode: 'agency', compliance });
    expect(derived).toMatchObject({ tier: 'pending', label: 'Mismatch', hasOverride: false });
    expect(eimsBucket(derived, false, true)).toBe('billedUnresolved');
  });
});
