jest.mock('../fieldEncryption', () => ({ decryptField: jest.fn() }));
jest.mock('../../constants/njeis', () => ({
  serviceCodeLabel: jest.fn((code) => (code ? `Label(${code})` : null)),
  locationCodeLabel: jest.fn((code) => (code ? `Loc(${code})` : null)),
  groupSizeCodeLabel: jest.fn((code) => (code ? `Group(${code})` : null)),
}));
jest.mock('../formatting', () => ({ formatTime12h: jest.fn((t) => `T${t}`) }));

const { decryptField } = require('../fieldEncryption');
const {
  formatInvoiceNumber,
  maskTaxId,
  formatPractitionerAddressLines,
  deriveEimsStatus,
  deriveLineAnomalies,
  loadComplianceForLines,
  buildInvoiceLines,
  summarizeInvoiceTotals,
} = require('../invoiceData');

describe('formatInvoiceNumber', () => {
  it('derives from the first 8 hex chars of the batch uuid, uppercased', () => {
    expect(formatInvoiceNumber('3f9a21c0-88e4-4a1b-9c2d-7e6f1a0b2c3d')).toBe('INV-3F9A21C0');
  });

  it('falls back to INV-PENDING when batchId is missing', () => {
    expect(formatInvoiceNumber(null)).toBe('INV-PENDING');
    expect(formatInvoiceNumber(undefined)).toBe('INV-PENDING');
  });
});

describe('maskTaxId', () => {
  afterEach(() => jest.clearAllMocks());

  it('masks an SSN-shaped value as XXX-XX-####', () => {
    decryptField.mockReturnValue('123-45-6789');
    expect(maskTaxId('enc')).toBe('XXX-XX-6789');
  });

  it('masks an EIN-shaped value as XX-XXX####', () => {
    decryptField.mockReturnValue('12-3456789');
    expect(maskTaxId('enc')).toBe('XX-XXX6789');
  });

  it('returns empty string when fewer than 4 digits are present', () => {
    decryptField.mockReturnValue('12');
    expect(maskTaxId('enc')).toBe('');
  });

  it('returns empty string when decryptField yields nothing', () => {
    decryptField.mockReturnValue(null);
    expect(maskTaxId(null)).toBe('');
  });
});

describe('formatPractitionerAddressLines', () => {
  it('prefers structured address parts when present', () => {
    const lines = formatPractitionerAddressLines({
      address_line1: '123 Main St',
      address_city: 'Trenton',
      address_state: 'NJ',
      address_zip: '08601',
      address: 'ignored legacy string',
    });
    expect(lines).toEqual(['123 Main St', 'Trenton, NJ 08601']);
  });

  it('falls back to the legacy address column when structured parts are absent', () => {
    expect(formatPractitionerAddressLines({ address: '456 Oak Ave' })).toEqual(['456 Oak Ave']);
  });

  it('returns an empty array when nothing is set', () => {
    expect(formatPractitionerAddressLines({})).toEqual([]);
    expect(formatPractitionerAddressLines(null)).toEqual([]);
  });
});

describe('deriveEimsStatus', () => {
  const base = { eims_missing_status: null, eims_entered_at: null, is_override: false, total_time: 60 };

  it('zero-duration (cancelled/no-show) sessions are cleared with a distinct label, not Matched', () => {
    expect(
      deriveEimsStatus({ ...base, total_time: 0 }, { mode: 'agency', compliance: { documentOnFile: true, matched: true, flagged: false } })
    ).toEqual({ tier: 'cleared', label: 'Cancelled' });
  });

  it('zero-duration short-circuits ahead of independent-mode EIMS entry checks too', () => {
    expect(deriveEimsStatus({ ...base, total_time: null }, { mode: 'independent', compliance: null })).toEqual({
      tier: 'cleared',
      label: 'Cancelled',
    });
  });

  it('override mode is cleared for payment (admin actively approved it)', () => {
    expect(deriveEimsStatus(base, { mode: 'override', compliance: null })).toEqual({
      tier: 'cleared',
      label: 'Override',
    });
  });

  it('assessment.is_override forces cleared regardless of mode', () => {
    expect(deriveEimsStatus({ ...base, is_override: true }, { mode: 'agency', compliance: null })).toEqual({
      tier: 'cleared',
      label: 'Override',
    });
  });

  it('eims_missing_status rejected is always an exception, never paid', () => {
    expect(deriveEimsStatus({ ...base, eims_missing_status: 'rejected' }, { mode: 'agency', compliance: {} })).toEqual({
      tier: 'exception',
      label: 'Rejected',
    });
  });

  it('rejected takes priority over is_override — a later rejection still blocks payment', () => {
    expect(
      deriveEimsStatus({ ...base, is_override: true, eims_missing_status: 'rejected' }, { mode: 'agency', compliance: null })
    ).toEqual({ tier: 'exception', label: 'Rejected' });
  });

  it('independent mode: entered self-reported is cleared', () => {
    expect(deriveEimsStatus({ ...base, eims_entered_at: '2026-01-01' }, { mode: 'independent', compliance: null })).toEqual({
      tier: 'cleared',
      label: 'Self-rep.',
    });
  });

  it('independent mode: not entered is pending', () => {
    expect(deriveEimsStatus(base, { mode: 'independent', compliance: null })).toEqual({
      tier: 'pending',
      label: 'Not entered',
    });
  });

  it('agency mode: no compliance object is unverified', () => {
    expect(deriveEimsStatus(base, { mode: 'agency', compliance: null })).toEqual({
      tier: 'unverified',
      label: 'Unverified',
    });
  });

  it('agency mode: duplicateOfSessionId is an exception with a note', () => {
    expect(
      deriveEimsStatus(base, { mode: 'agency', compliance: { duplicateOfSessionId: 42, documentOnFile: true } })
    ).toEqual({ tier: 'exception', label: 'Duplicate', note: 'Duplicate of #42' });
  });

  it('agency mode: no document on file is unverified with a note', () => {
    expect(deriveEimsStatus(base, { mode: 'agency', compliance: { documentOnFile: false } })).toEqual({
      tier: 'unverified',
      label: 'Unverified',
      note: 'No state file uploaded',
    });
  });

  it('agency mode: matched and not flagged is cleared', () => {
    expect(
      deriveEimsStatus(base, { mode: 'agency', compliance: { documentOnFile: true, matched: true, flagged: false } })
    ).toEqual({ tier: 'cleared', label: 'Matched' });
  });

  it('agency mode: matched and not flagged only because a field was manually "Allow"-ed reads as an exception, not Matched', () => {
    expect(
      deriveEimsStatus(base, {
        mode: 'agency',
        compliance: {
          documentOnFile: true, matched: true, flagged: false,
          fields: [
            { key: 'start_time', match: true },
            { key: 'location', match: true, acknowledged: true },
          ],
        },
      })
    ).toEqual({ tier: 'cleared', label: 'Exception' });
  });

  it('agency mode: matched and not flagged via a reusable learned-override rule also reads as an exception', () => {
    expect(
      deriveEimsStatus(base, {
        mode: 'agency',
        compliance: {
          documentOnFile: true, matched: true, flagged: false,
          fields: [{ key: 'service_type', match: true, learnedMatch: true }],
        },
      })
    ).toEqual({ tier: 'cleared', label: 'Exception' });
  });

  it('agency mode: matched and flagged is pending (field mismatch)', () => {
    expect(
      deriveEimsStatus(base, { mode: 'agency', compliance: { documentOnFile: true, matched: true, flagged: true } })
    ).toEqual({ tier: 'pending', label: 'Mismatch' });
  });

  it('agency mode: not matched but admin-approved is cleared', () => {
    expect(
      deriveEimsStatus(
        { ...base, eims_missing_status: 'approved' },
        { mode: 'agency', compliance: { documentOnFile: true, matched: false, flagged: false } }
      )
    ).toEqual({ tier: 'cleared', label: 'Approved' });
  });

  it('agency mode: not matched but sent to admin is pending', () => {
    expect(
      deriveEimsStatus(
        { ...base, eims_missing_status: 'sent_to_admin' },
        { mode: 'agency', compliance: { documentOnFile: true, matched: false, flagged: false } }
      )
    ).toEqual({ tier: 'pending', label: 'Awaiting' });
  });

  it('agency mode: not matched with no other signal is an exception', () => {
    expect(
      deriveEimsStatus(base, { mode: 'agency', compliance: { documentOnFile: true, matched: false, flagged: false } })
    ).toEqual({ tier: 'exception', label: 'Missing' });
  });
});

describe('deriveLineAnomalies', () => {
  it('does not flag zero hours — indistinguishable from a legitimate cancellation, handled by EIMS status instead', () => {
    expect(deriveLineAnomalies({ patients: { child_id: 'C1' } }, 0)).toEqual([]);
  });

  it('flags missing child id', () => {
    expect(deriveLineAnomalies({ patients: {} }, 1.5)).toEqual(['Missing child ID']);
  });

  it('flags missing child id even when hours are also zero', () => {
    expect(deriveLineAnomalies({ patients: {} }, 0)).toEqual(['Missing child ID']);
  });

  it('returns an empty array when nothing is wrong', () => {
    expect(deriveLineAnomalies({ patients: { child_id: 'C1' } }, 1)).toEqual([]);
  });
});

describe('loadComplianceForLines', () => {
  it('resolves every id via the injected compute function', async () => {
    const computeFn = jest.fn(async (id) => ({ matched: true, flagged: false, documentOnFile: true, id }));
    const result = await loadComplianceForLines([1, 2, 3], computeFn, { concurrency: 2 });
    expect(result.size).toBe(3);
    expect(result.get(2)).toEqual({ matched: true, flagged: false, documentOnFile: true, id: 2 });
    expect(computeFn).toHaveBeenCalledTimes(3);
  });

  it('falls back to a safe unverified shape when a lookup throws, without blocking the others', async () => {
    const computeFn = jest.fn(async (id) => {
      if (id === 2) throw new Error('boom');
      return { matched: true, flagged: false, documentOnFile: true };
    });
    const result = await loadComplianceForLines([1, 2, 3], computeFn);
    expect(result.get(2)).toEqual({ matched: false, flagged: false, documentOnFile: false });
    expect(result.get(1).matched).toBe(true);
    expect(result.get(3).matched).toBe(true);
  });
});

describe('buildInvoiceLines', () => {
  const practitioner = { pay_rate: '40.00' };

  it('maps raw assessment rows into InvoiceLine shape with correct hours/lineTotal', () => {
    const assessments = [
      {
        id: 7,
        service_date: '2026-01-05',
        patient_first_name: 'Ada',
        patient_last_name: 'Lovelace',
        patient_county: 'mercer',
        patients: { child_id: 'C100' },
        type: 'OT',
        location: 'home',
        group_size_category: 'individual',
        total_time: 90,
        start_time: '09:00',
        end_time: '10:30',
      },
    ];
    const lines = buildInvoiceLines(assessments, practitioner, { mode: 'agency', complianceById: null });
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.assessmentId).toBe(7);
    expect(line.childName).toBe('Ada Lovelace');
    expect(line.childId).toBe('C100');
    expect(line.county).toBe('MERCER');
    expect(line.serviceLabel).toBe('Label(OT)');
    expect(line.locationLabel).toBe('Loc(home)');
    expect(line.groupSizeLabel).toBe('Group(individual)');
    expect(line.hours).toBe(1.5);
    expect(line.rate).toBe(40);
    expect(line.lineTotal).toBe(60);
    expect(line.timeLabel).toBe('T09:00–T10:30');
    expect(line.eims).toEqual({ tier: 'unverified', label: 'Unverified' });
    expect(line.anomalies).toEqual([]);
  });

  it('rounds lineTotal to the nearest cent', () => {
    const assessments = [{ id: 1, total_time: 50, patients: {} }];
    const lines = buildInvoiceLines(assessments, { pay_rate: '33.33' }, { mode: 'agency', complianceById: null });
    // 50/60 hours * 33.33 = 27.775 -> rounds to 27.78 (banker's rounding not used; Math.round(2777.5)/100)
    expect(lines[0].lineTotal).toBeCloseTo(27.78, 2);
  });

  it('treats a zero or missing pay rate as zero (no division/NaN)', () => {
    const assessments = [{ id: 1, total_time: 60, patients: {} }];
    const lines = buildInvoiceLines(assessments, { pay_rate: '0' }, { mode: 'agency', complianceById: null });
    expect(lines[0].rate).toBe(0);
    expect(lines[0].lineTotal).toBe(0);
  });

  it('pulls compliance by assessment id from the complianceById map', () => {
    const complianceById = new Map([[9, { matched: true, flagged: false, documentOnFile: true }]]);
    const assessments = [{ id: 9, total_time: 60, patients: { child_id: 'C1' } }];
    const lines = buildInvoiceLines(assessments, practitioner, { mode: 'agency', complianceById });
    expect(lines[0].eims).toEqual({ tier: 'cleared', label: 'Matched' });
  });

  it('a cancelled (zero-duration) session reads as Cancelled, not Matched, and carries no anomaly', () => {
    const complianceById = new Map([[9, { matched: true, flagged: false, documentOnFile: true }]]);
    const assessments = [{ id: 9, total_time: 0, patients: { child_id: 'C1' } }];
    const lines = buildInvoiceLines(assessments, practitioner, { mode: 'agency', complianceById });
    expect(lines[0].eims).toEqual({ tier: 'cleared', label: 'Cancelled' });
    expect(lines[0].lineTotal).toBe(0);
    expect(lines[0].anomalies).toEqual([]);
  });
});

describe('summarizeInvoiceTotals', () => {
  const line = (tier, lineTotal, hours = 1) => ({ hours, lineTotal, eims: { tier, label: tier } });

  it('sums totalDue from cleared lines only, excluding pending/exception/unverified', () => {
    const lines = [
      line('cleared', 40),
      line('cleared', 40),
      line('pending', 40),
      line('exception', 40),
      line('unverified', 40),
    ];
    const result = summarizeInvoiceTotals(lines);
    expect(result.totalDue).toBe(80);
    expect(result.totalHeld).toBe(120);
    expect(result.totalHours).toBe(5);
    expect(result.dueLines).toHaveLength(2);
    expect(result.heldLines).toHaveLength(3);
  });

  it('totalDue equals the full sum when every line is cleared', () => {
    const lines = [line('cleared', 40), line('cleared', 60)];
    const result = summarizeInvoiceTotals(lines);
    expect(result.totalDue).toBe(100);
    expect(result.totalHeld).toBe(0);
  });

  it('totalDue is zero when no line is cleared', () => {
    const lines = [line('pending', 40), line('exception', 60)];
    const result = summarizeInvoiceTotals(lines);
    expect(result.totalDue).toBe(0);
    expect(result.totalHeld).toBe(100);
  });

  it('handles an empty invoice without throwing', () => {
    const result = summarizeInvoiceTotals([]);
    expect(result).toEqual({ totalHours: 0, totalDue: 0, totalHeld: 0, dueLines: [], heldLines: [] });
  });
});
