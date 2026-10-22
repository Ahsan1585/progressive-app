// Optional scan of the signed paper consent, stored with the consent.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/storage', () => ({
  NJEIS_FORMS_BUCKET: 'forms-bucket',
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  removeFiles: jest.fn(),
}));

const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { uploadFile, downloadFile, removeFiles } = require('../../config/storage');
const { uploadConsentScan, downloadConsentScan } = require('../consentScanController');

afterEach(() => jest.resetAllMocks());

const PDF = Buffer.from('%PDF-1.4\n%fake body for the test');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]);
const dataUrl = (buf, mime = 'application/pdf') => `data:${mime};base64,${buf.toString('base64')}`;

const mockRes = () => {
  const res = { headers: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  res.set = jest.fn();
  return res;
};
const req = (body = {}, o = {}) => ({
  params: { id: '10', consentId: '55' }, body, headers: {},
  practitioner: { practitionerId: 3, role: 'ceo' }, ...o,
});
const paperConsent = (o = {}) => ({ id: 55, patient_id: 10, source: 'paper', paper_scan_path: null, paper_scan_filename: null, ...o });

function primeDb(consent = paperConsent()) {
  pool.query.mockImplementation(async (sql) => {
    if (/SELECT .* FROM records_consents/s.test(sql)) return { rows: consent ? [consent] : [] };
    if (/UPDATE records_consents/.test(sql)) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('uploadConsentScan', () => {
  test('stores a PDF under a random consent-scans path (never the client filename) and records it', async () => {
    primeDb();
    uploadFile.mockResolvedValue();
    const res = mockRes();
    await uploadConsentScan(req({ filename: '../../evil name.pdf', fileBase64: dataUrl(PDF) }), res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    const [bucket, path, buffer, type] = uploadFile.mock.calls[0];
    expect(bucket).toBe('forms-bucket');
    expect(path).toMatch(/^consent-scans\/55-[a-f0-9]{16,}\.pdf$/);
    expect(path).not.toMatch(/evil/);
    expect(Buffer.compare(buffer, PDF)).toBe(0);
    expect(type).toBe('application/pdf');
    const update = pool.query.mock.calls.find(([sql]) => /UPDATE records_consents/.test(sql));
    expect(update[1]).toContain(path);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'consent_scan_uploaded', resourceType: 'patient', resourceId: '10' }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('accepts a PNG', async () => {
    primeDb();
    uploadFile.mockResolvedValue();
    await uploadConsentScan(req({ filename: 's.png', fileBase64: dataUrl(PNG, 'image/png') }), mockRes());
    expect(uploadFile.mock.calls[0][1]).toMatch(/\.png$/);
  });

  test('replacing a scan removes the old object', async () => {
    primeDb(paperConsent({ paper_scan_path: 'consent-scans/55-old.pdf' }));
    uploadFile.mockResolvedValue();
    removeFiles.mockResolvedValue();
    await uploadConsentScan(req({ filename: 's.pdf', fileBase64: dataUrl(PDF) }), mockRes());
    expect(removeFiles).toHaveBeenCalledWith('forms-bucket', ['consent-scans/55-old.pdf']);
  });

  test.each([
    ['not a data URL', { fileBase64: 'abc' }],
    ['missing', {}],
    ['wrong declared type', { fileBase64: dataUrl(PDF, 'text/html') }],
    ['declared PDF but not PDF bytes', { fileBase64: dataUrl(Buffer.from('<script>alert(1)</script>'), 'application/pdf') }],
    ['over 10MB', { fileBase64: dataUrl(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024 + 1)])) }],
    ['empty', { fileBase64: 'data:application/pdf;base64,' }],
  ])('400 for %s, nothing stored', async (_n, body) => {
    primeDb();
    const res = mockRes();
    await uploadConsentScan(req({ filename: 's.pdf', ...body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  test('only paper consents take a scan', async () => {
    primeDb(paperConsent({ source: 'electronic' }));
    const res = mockRes();
    await uploadConsentScan(req({ filename: 's.pdf', fileBase64: dataUrl(PDF) }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  test('404 for a malformed id or another child\'s consent', async () => {
    primeDb(null);
    const res = mockRes();
    await uploadConsentScan(req({ filename: 's.pdf', fileBase64: dataUrl(PDF) }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    const res2 = mockRes();
    await uploadConsentScan(req({}, { params: { id: 'x', consentId: '55' } }), res2);
    expect(res2.status).toHaveBeenCalledWith(404);
  });

  test('a storage failure is a 500 and the consent row is not updated', async () => {
    primeDb();
    uploadFile.mockRejectedValue(new Error('gcs'));
    const res = mockRes();
    await uploadConsentScan(req({ filename: 's.pdf', fileBase64: dataUrl(PDF) }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE records_consents/.test(sql))).toBe(false);
  });
});

describe('downloadConsentScan', () => {
  test('streams the scan with safe headers and audits the view', async () => {
    primeDb(paperConsent({ paper_scan_path: 'consent-scans/55-abc.pdf', paper_scan_filename: 'signed.pdf' }));
    downloadFile.mockResolvedValue(PDF);
    const res = mockRes();
    await downloadConsentScan(req(), res);
    expect(downloadFile).toHaveBeenCalledWith('forms-bucket', 'consent-scans/55-abc.pdf');
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Disposition']).toMatch(/^attachment;/);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'consent_scan_viewed', resourceId: '10' }));
  });

  test('404 when there is no scan', async () => {
    primeDb(paperConsent());
    const res = mockRes();
    await downloadConsentScan(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(downloadFile).not.toHaveBeenCalled();
  });
});
