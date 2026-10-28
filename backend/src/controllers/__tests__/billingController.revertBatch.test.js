jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/storage', () => ({
  BILLING_INVOICES_BUCKET: 'test-bucket',
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  getSignedUrl: jest.fn(),
  removeFiles: jest.fn().mockResolvedValue(),
  listFilesDetailed: jest.fn(),
}));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));

const { pool } = require('../../config/db');
const { revertBillingBatch } = require('../billingController');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('revertBillingBatch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('only resets rows the batch actually advanced (njeis_review/invoiced/completed), leaving rejected/declined/on_hold untouched', async () => {
    const req = { body: { batchId: 42 } };
    const res = mockRes();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, njeis_path: 'path/a.pdf', invoice_path: null, paid_at: null }] }) // batch lookup
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) // the scoped UPDATE ... RETURNING id
      .mockResolvedValueOnce({ rows: [] }) // compliance_field_acknowledgments cleanup
      .mockResolvedValueOnce({ rows: [] }); // DELETE billing_batches

    await revertBillingBatch(req, res);

    const updateCall = pool.query.mock.calls.find(([sql]) => sql.includes('SET billing_status'));
    expect(updateCall[0]).toContain("billing_status IN ('njeis_review', 'invoiced', 'completed')");
    expect(updateCall[1]).toEqual([42]);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, assessmentsReverted: 2 }));
  });

  it('404s when the batch no longer exists', async () => {
    const req = { body: { batchId: 99 } };
    const res = mockRes();
    pool.query.mockResolvedValueOnce({ rows: [] });

    await revertBillingBatch(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('refuses to revert a batch already marked paid', async () => {
    const req = { body: { batchId: 7 } };
    const res = mockRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 7, njeis_path: null, invoice_path: null, paid_at: '2026-01-01T00:00:00Z' }] });

    await revertBillingBatch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
