jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/storage', () => ({
  BILLING_INVOICES_BUCKET: 'test-bucket',
  downloadFile: jest.fn(),
}));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));

const crypto = require('crypto');
const { pool } = require('../../config/db');
const { downloadFile } = require('../../config/storage');
const { logAudit } = require('../../utils/auditLog');
const { REDISCLOSURE_NOTICE } = require('../../utils/emailClient');
const {
  createSharedDocumentLink,
  revokeSharedDocumentLink,
  getSharedDocumentLanding,
  downloadSharedDocument,
  SHARED_LINK_TTL_MS,
} = require('../sharedDocumentController');

const RAW = 'a'.repeat(64);
const HASH = crypto.createHash('sha256').update(RAW).digest('hex');

afterEach(() => jest.resetAllMocks());

const mockRes = () => {
  const res = { headers: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn((k, v) => {
    if (typeof k === 'object') Object.assign(res.headers, k); else res.headers[k] = v;
    return res;
  });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  return res;
};

const validLinkRow = (over = {}) => ({
  id: 5, batch_id: 'batch-1', patient_id: 10, recipient_email: 'billing@abc.org',
  expires_at: new Date(Date.now() + 86400000), revoked_at: null,
  njeis_path: '2026-10/Jane_Doe/SEVF.pdf', invoice_path: '2026-10/Jane_Doe/Invoice.pdf',
  practitioner_first_name: 'Jane', practitioner_last_name: 'Doe',
  ...over,
});

describe('createSharedDocumentLink', () => {
  test('stores only the sha256 hash of the token, 14-day expiry, and returns a URL with the raw token', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, expires_at: new Date() }] });

    const out = await createSharedDocumentLink({
      batchId: 'batch-1', patientId: 10, recipientEmail: 'billing@abc.org', createdBy: 7,
      companySlug: 'acme', baseUrl: 'https://api.example.com',
    });

    expect(SHARED_LINK_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO shared_document_links/);
    const rawToken = out.url.split('/').pop();
    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(params).not.toContain(rawToken);
    expect(params[0]).toBe(crypto.createHash('sha256').update(rawToken).digest('hex'));
    expect(params).toEqual(expect.arrayContaining(['batch-1', 10, 'billing@abc.org', 7]));
    const expires = params.find((p) => p instanceof Date || (typeof p === 'string' && /T.*Z$/.test(p)));
    expect(new Date(expires).getTime() - Date.now()).toBeGreaterThan(13.9 * 86400000);
    expect(out.url).toBe(`https://api.example.com/api/shared-documents/acme/${rawToken}`);
    expect(out.linkId).toBe(5);
  });
});

describe('revokeSharedDocumentLink', () => {
  test('sets revoked_at', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await revokeSharedDocumentLink(5);
    expect(pool.query.mock.calls[0][0]).toMatch(/SET revoked_at = now\(\)/);
    expect(pool.query.mock.calls[0][1]).toEqual([5]);
  });
});

describe('getSharedDocumentLanding', () => {
  test('rejects a malformed token without querying the DB', async () => {
    const res = mockRes();
    await getSharedDocumentLanding({ params: { companySlug: 'acme', token: 'nope' } }, res);
    expect(pool.query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('looks the link up by token hash, never the raw token', async () => {
    pool.query.mockResolvedValueOnce({ rows: [validLinkRow()] });
    const res = mockRes();
    await getSharedDocumentLanding({ params: { companySlug: 'acme', token: RAW } }, res);
    expect(pool.query.mock.calls[0][1]).toEqual([HASH]);
  });

  test('serves a no-store HTML page with the redisclosure notice and download links, no child data', async () => {
    pool.query.mockResolvedValueOnce({ rows: [validLinkRow()] });
    const res = mockRes();
    await getSharedDocumentLanding({ params: { companySlug: 'acme', token: RAW } }, res);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    const html = res.send.mock.calls[0][0];
    expect(html).toContain(REDISCLOSURE_NOTICE);
    expect(html).toContain(`${RAW}/sevf`);
    expect(html).toContain(`${RAW}/invoice`);
    expect(html).toContain('Jane Doe');
    expect(logAudit).not.toHaveBeenCalled(); // opening the page is not a download
  });

  test('omits the invoice link when the batch has none', async () => {
    pool.query.mockResolvedValueOnce({ rows: [validLinkRow({ invoice_path: null })] });
    const res = mockRes();
    await getSharedDocumentLanding({ params: { companySlug: 'acme', token: RAW } }, res);
    expect(res.send.mock.calls[0][0]).not.toContain(`${RAW}/invoice`);
  });

  test.each([
    ['expired', { expires_at: new Date(Date.now() - 1000) }],
    ['revoked', { revoked_at: new Date() }],
  ])('returns 410 for a %s link', async (_label, over) => {
    pool.query.mockResolvedValueOnce({ rows: [validLinkRow(over)] });
    const res = mockRes();
    await getSharedDocumentLanding({ params: { companySlug: 'acme', token: RAW } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  test('returns 404 for an unknown token', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await getSharedDocumentLanding({ params: { companySlug: 'acme', token: RAW } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('downloadSharedDocument', () => {
  test('streams the SEVF with no-store + notice header, records the download, and logs it against the child', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [validLinkRow()] })
      .mockResolvedValueOnce({ rows: [] }); // download counter update
    downloadFile.mockResolvedValueOnce(Buffer.from('%PDF'));
    const res = mockRes();
    const req = { params: { companySlug: 'acme', token: RAW, docType: 'sevf' }, headers: {} };

    await downloadSharedDocument(req, res);

    expect(downloadFile).toHaveBeenCalledWith('test-bucket', '2026-10/Jane_Doe/SEVF.pdf');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toMatch(/attachment; filename="SEVF\.pdf"/);
    expect(res.headers['X-Redisclosure-Notice']).toBe(REDISCLOSURE_NOTICE);
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF'));

    const [updSql, updParams] = pool.query.mock.calls[1];
    expect(updSql).toMatch(/download_count = download_count \+ 1/);
    expect(updSql).toMatch(/first_downloaded_at = COALESCE\(first_downloaded_at, now\(\)\)/);
    expect(updParams).toEqual([5]);

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shared_document_downloaded',
      resourceType: 'patient',
      resourceId: 10,
      actorEmail: 'billing@abc.org',
      details: expect.objectContaining({ batchId: 'batch-1', document: 'sevf', recipientEmail: 'billing@abc.org' }),
    }));
  });

  test('serves the invoice when asked', async () => {
    pool.query.mockResolvedValueOnce({ rows: [validLinkRow()] }).mockResolvedValueOnce({ rows: [] });
    downloadFile.mockResolvedValueOnce(Buffer.from('%PDF'));
    const res = mockRes();
    await downloadSharedDocument({ params: { companySlug: 'acme', token: RAW, docType: 'invoice' }, headers: {} }, res);
    expect(downloadFile).toHaveBeenCalledWith('test-bucket', '2026-10/Jane_Doe/Invoice.pdf');
  });

  test('404 for an unknown docType or a missing invoice', async () => {
    const res1 = mockRes();
    await downloadSharedDocument({ params: { companySlug: 'acme', token: RAW, docType: 'other' }, headers: {} }, res1);
    expect(res1.status).toHaveBeenCalledWith(404);

    pool.query.mockResolvedValueOnce({ rows: [validLinkRow({ invoice_path: null })] });
    const res2 = mockRes();
    await downloadSharedDocument({ params: { companySlug: 'acme', token: RAW, docType: 'invoice' }, headers: {} }, res2);
    expect(res2.status).toHaveBeenCalledWith(404);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test('410 and no file served for an expired link', async () => {
    pool.query.mockResolvedValueOnce({ rows: [validLinkRow({ expires_at: new Date(Date.now() - 1) })] });
    const res = mockRes();
    await downloadSharedDocument({ params: { companySlug: 'acme', token: RAW, docType: 'sevf' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(downloadFile).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
