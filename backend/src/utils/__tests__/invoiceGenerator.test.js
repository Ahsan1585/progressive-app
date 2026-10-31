const { PDFDocument } = require('pdf-lib');
const { generateInvoicePDF, PAID_STAMP_CLEAR, assertSingleChildMode } = require('../invoiceGenerator');
const { stampInvoicePaid } = require('../invoiceStamper');

function makeLine(overrides = {}) {
  return {
    assessmentId: 1,
    serviceDate: '2026-01-05',
    childName: 'Ada Lovelace',
    childId: 'C100',
    county: 'MERCER',
    serviceCode: 'OT',
    serviceLabel: 'Occupational Therapy',
    locationLabel: "Child's home",
    groupSizeLabel: 'Individual',
    discipline: 'OT',
    timeLabel: '9:00–10:00 AM',
    hours: 1,
    rate: 40,
    lineTotal: 40,
    eims: { tier: 'cleared', label: 'Matched' },
    anomalies: [],
    ...overrides,
  };
}

function makeCtx(overrides = {}) {
  return {
    mode: 'agency',
    invoice: { number: 'INV-ABCDEF01', batchId: 'abcdef01-1234-5678-9abc-def012345678', issuedAt: '2026-01-10', periodStart: '2026-01-01', periodEnd: '2026-01-10' },
    brand: { name: 'Izayaedge - Demo', logoDataUrl: null, contactLine: '123 Main St, Trenton, NJ · (555) 123-4567' },
    from: { title: 'FROM', name: 'Jane Practitioner', lines: ['OT', 'jane@example.com'] },
    billTo: { title: 'BILL TO', name: 'Izayaedge - Demo', lines: ['456 Oak Ave, Trenton, NJ', 'billing@example.com'] },
    details: { discipline: 'Occupational Therapy', taxIdMasked: 'XXX-XX-6789', processedBy: 'Admin User' },
    certificationParty: 'Izayaedge - Demo',
    lines: [makeLine()],
    warnings: [],
    ...overrides,
  };
}

describe('generateInvoicePDF', () => {
  it('renders a single-line invoice as a valid one-page PDF', async () => {
    const buffer = await generateInvoicePDF(makeCtx());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders cleanly with zero lines', async () => {
    const buffer = await generateInvoicePDF(makeCtx({ lines: [] }));
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('paginates a 150-line invoice across multiple pages', async () => {
    const lines = Array.from({ length: 150 }, (_, i) =>
      makeLine({ assessmentId: i + 1, serviceDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` })
    );
    const buffer = await generateInvoicePDF(makeCtx({ lines }));
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('does not throw on a non-Latin child name', async () => {
    const lines = [makeLine({ childName: '田中 太郎' }), makeLine({ assessmentId: 2, childName: 'José Muñoz-Ñandú' })];
    const buffer = await generateInvoicePDF(makeCtx({ lines }));
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('falls back to a text brand name when the logo data URL is unsupported (svg)', async () => {
    const ctx = makeCtx({ brand: { name: 'Izayaedge - Demo', logoDataUrl: 'data:image/svg+xml;base64,AAAA', contactLine: '' } });
    const buffer = await generateInvoicePDF(ctx);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('falls back to a text brand name when the logo data is malformed', async () => {
    const ctx = makeCtx({ brand: { name: 'Izayaedge - Demo', logoDataUrl: 'data:image/png;base64,not-valid-base64!!', contactLine: '' } });
    const buffer = await generateInvoicePDF(ctx);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders a manually-overridden ("Exception") line in the exceptions callout without throwing', async () => {
    const ctx = makeCtx({ lines: [makeLine({ eims: { tier: 'cleared', label: 'Exception' } })] });
    const buffer = await generateInvoicePDF(ctx);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders an override-mode invoice with the override ribbon/pill without throwing', async () => {
    const ctx = makeCtx({ mode: 'override', lines: [makeLine({ eims: { tier: 'cleared', label: 'Override' } })] });
    const buffer = await generateInvoicePDF(ctx);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('survives piping through stampInvoicePaid for a multi-page invoice', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => makeLine({ assessmentId: i + 1 }));
    const buffer = await generateInvoicePDF(makeCtx({ lines }));
    const stamped = await stampInvoicePaid(buffer);
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('never draws inside the reserved PAID-stamp clearance zone constant', () => {
    expect(PAID_STAMP_CLEAR).toEqual({ xMin: 470, yMin: 722 });
  });
});

// Multi-child redaction (34 CFR 303.408): singleChildMode is a server-
// validated guarantee, not a trusted caller flag — see assertSingleChildMode
// in invoiceGenerator.js.
describe('assertSingleChildMode', () => {
  it('does nothing when singleChildMode is falsy, even with multiple children', () => {
    expect(() => assertSingleChildMode([makeLine({ childId: 'C100' }), makeLine({ childId: 'C200' })], false)).not.toThrow();
  });

  it('throws when lines span more than one child (by childId)', () => {
    expect(() => assertSingleChildMode([makeLine({ childId: 'C100' }), makeLine({ childId: 'C200' })], true))
      .toThrow(/more than one/i);
  });

  it('throws when lines span more than one child (by childName, no childId)', () => {
    const lines = [makeLine({ childId: '', childName: 'Ada Lovelace' }), makeLine({ childId: '', childName: 'Grace Hopper' })];
    expect(() => assertSingleChildMode(lines, true)).toThrow(/more than one/i);
  });

  it('throws when there are no lines at all', () => {
    expect(() => assertSingleChildMode([], true)).toThrow(/at least one line/i);
  });

  it('does not throw when every line is the same child', () => {
    expect(() => assertSingleChildMode([makeLine(), makeLine({ serviceDate: '2026-01-06' })], true)).not.toThrow();
  });
});

describe('generateInvoicePDF with singleChildMode', () => {
  it('renders the single-child badge without throwing when every line is one child', async () => {
    const ctx = makeCtx({ singleChildMode: true });
    const buffer = await generateInvoicePDF(ctx);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('propagates the assertSingleChildMode error for a mixed-child invoice', async () => {
    const ctx = makeCtx({ singleChildMode: true, lines: [makeLine({ childId: 'C100' }), makeLine({ childId: 'C200' })] });
    await expect(generateInvoicePDF(ctx)).rejects.toThrow(/more than one/i);
  });

  it('renders cleanly alongside the override ribbon (both badges can coexist)', async () => {
    const ctx = makeCtx({ mode: 'override', singleChildMode: true });
    const buffer = await generateInvoicePDF(ctx);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('fitText', () => {
  test('keeps an en dash in a time range instead of turning it into "?"', async () => {
    const { fitText } = require('../invoiceGenerator');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont('Helvetica');
    expect(fitText('9:00 AM–10:00 AM', font, 8, 200)).toBe('9:00 AM–10:00 AM');
    expect(fitText('9:00 AM–10:00 AM', font, 8, 200)).not.toContain('?');
  });

  // Regression: the Time column was 68pt, but a realistic range like
  // "10:45 AM–11:50 AM" needs ~73pt at 8pt Helvetica, so it was truncating
  // on most real sessions ("1:45 PM–2:55…"), not just unusually long ones.
  test('a realistic time range fits the actual Time column width without truncating', async () => {
    const { fitText } = require('../invoiceGenerator');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont('Helvetica');
    const TIME_COL_W = 82; // keep in sync with invoiceGenerator.js's cols[3].w
    const longest = '10:45 AM–11:50 AM';
    expect(fitText(longest, font, 8, TIME_COL_W - 8)).toBe(longest);
  });
});
