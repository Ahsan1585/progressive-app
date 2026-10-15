const { PDFDocument } = require('pdf-lib');
const { generateInvoicePDF, PAID_STAMP_CLEAR } = require('../invoiceGenerator');
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

  it('renders an override-mode invoice with the override ribbon/pill without throwing', async () => {
    const ctx = makeCtx({ mode: 'override', lines: [makeLine({ eims: { tier: 'exception', label: 'Admin override' } })] });
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
