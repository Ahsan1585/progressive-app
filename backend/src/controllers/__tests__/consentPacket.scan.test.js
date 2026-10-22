// A paper consent's scanned signed form travels with the disclosure packet, so
// the recipient sees the parent's actual signature and not only the app's
// record of it. A scan that cannot be merged never blocks the packet; the
// consent page says so instead.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn().mockResolvedValue('Acme EI') }));
jest.mock('../../config/storage', () => ({ NJEIS_FORMS_BUCKET: 'forms-bucket', downloadFile: jest.fn() }));
jest.mock('../patientRecordExportController', () => ({
  ...jest.requireActual('../patientRecordExportController'),
  drawSessionLogSection: jest.fn(),
  appendSevfSection: jest.fn(),
  drawBillingSection: jest.fn(),
}));

const { PDFDocument } = require('pdf-lib');
const { pool } = require('../../config/db');
const { downloadFile } = require('../../config/storage');
const { buildConsentPacketPdf, buildConsentCopy } = require('../consentReportController');

beforeEach(() => {
  pool.query.mockResolvedValue({ rows: [] });
  downloadFile.mockReset();
});

const PATIENT = { id: 10, first_name: 'Timmy', last_name: 'OBrien', dob: '2024-03-05', child_id: 'NJ-1' };
const paperConsent = (o = {}) => ({
  id: 55, patient_id: 10, recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org', purpose: 'Billing',
  record_types: ['invoices'], granted_at: '2026-10-01T14:05:00Z', signed_on: '2026-09-30', expires_at: new Date(Date.now() + 1e10).toISOString(),
  revoked_at: null, source: 'paper', identity_verified_method: 'photo_id', identity_verified_note: null,
  proof_note: null, granted_by: null, paper_scan_path: 'consent-scans/55-abc.pdf', ...o,
});

async function pdfWithPages(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}
// 1x1 images (smallest valid files).
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const pageCount = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();
const build = (consent) => buildConsentPacketPdf({ patient: PATIENT, consent, generatedBy: 'Olive Office', grantedByName: 'Sam Staff' });

describe('packet with a paper scan', () => {
  test('a 2-page PDF scan adds its 2 pages after the consent page', async () => {
    const without = await pageCount(await build(paperConsent({ paper_scan_path: null })));
    downloadFile.mockResolvedValue(await pdfWithPages(2));
    const withScan = await pageCount(await build(paperConsent()));
    expect(downloadFile).toHaveBeenCalledWith('forms-bucket', 'consent-scans/55-abc.pdf');
    expect(withScan).toBe(without + 2);
  });

  test('a PNG scan adds one page', async () => {
    const without = await pageCount(await build(paperConsent({ paper_scan_path: null })));
    downloadFile.mockResolvedValue(PNG_1X1);
    const withScan = await pageCount(await build(paperConsent({ paper_scan_path: 'consent-scans/55-abc.png' })));
    expect(withScan).toBe(without + 1);
  });

  test('the scan follows the consent page (scan pages come before the record sections)', async () => {
    // invoices section draws via a mocked builder, so with no assessments an
    // "empty section" page is added after the scan: cover, consent, scan, section.
    downloadFile.mockResolvedValue(await pdfWithPages(1));
    expect(await pageCount(await build(paperConsent()))).toBe(
      (await pageCount(await build(paperConsent({ paper_scan_path: null })))) + 1
    );
  });
});

describe('when the scan cannot be used the packet still builds', () => {
  const baseline = async () => pageCount(await build(paperConsent({ paper_scan_path: null })));

  test.each([
    ['corrupt PDF bytes', () => downloadFile.mockResolvedValue(Buffer.from('%PDF-1.4 this is not really a pdf'))],
    ['not an image or PDF at all', () => downloadFile.mockResolvedValue(Buffer.from('<script>alert(1)</script>'))],
    ['storage failure', () => downloadFile.mockRejectedValue(new Error('gcs down'))],
  ])('%s', async (_n, arrange) => {
    const expected = await baseline();
    arrange();
    const bytes = await build(paperConsent());
    expect(await pageCount(bytes)).toBe(expected);
  });

  test('an over-long PDF (more than 25 pages) is not merged', async () => {
    const expected = await baseline();
    downloadFile.mockResolvedValue(await pdfWithPages(26));
    expect(await pageCount(await build(paperConsent()))).toBe(expected);
  });

  test('the consent page tells the recipient a scan exists but could not be attached', () => {
    const copy = buildConsentCopy(paperConsent(), { scanStatus: 'unavailable' });
    expect(Object.fromEntries(copy.rows)['Signed paper form:']).toMatch(/on file .* could not be attached/i);
  });
});

describe('when no scan applies, nothing is fetched', () => {
  test('electronic consents never touch storage', async () => {
    await build(paperConsent({ source: 'electronic', paper_scan_path: 'consent-scans/should-not-be-read.pdf' }));
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test('a paper consent without a scan never touches storage', async () => {
    await build(paperConsent({ paper_scan_path: null }));
    expect(downloadFile).not.toHaveBeenCalled();
  });
});

describe('consent page wording', () => {
  test('attached: says the signed form follows', () => {
    const copy = buildConsentCopy(paperConsent(), { scanStatus: 'attached' });
    expect(Object.fromEntries(copy.rows)['Signed paper form:']).toMatch(/follows this page/i);
  });

  test('no scan: no row at all', () => {
    const copy = buildConsentCopy(paperConsent({ paper_scan_path: null }), {});
    expect(Object.fromEntries(copy.rows)['Signed paper form:']).toBeUndefined();
  });

  test('electronic consents never get the row', () => {
    const copy = buildConsentCopy(paperConsent({ source: 'electronic' }), { scanStatus: 'attached' });
    expect(Object.fromEntries(copy.rows)['Signed paper form:']).toBeUndefined();
  });
});
