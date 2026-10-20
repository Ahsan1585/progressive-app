jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceForLines: jest.fn(),
  deriveEimsStatus: jest.fn(),
  formatInvoiceNumber: (id) => `INV-${String(id).slice(0, 8).toUpperCase()}`,
}));

const { pool } = require('../../config/db');
const { loadComplianceForLines, deriveEimsStatus } = require('../../utils/invoiceData');
const { getDocumentsFeed } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('getDocumentsFeed', () => {
  test('labels an independent-practitioner batch as SEVF and an agency batch as invoice', async () => {
    const req = {};
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ // batches
        rows: [
          { id: 'batch-agency-01', practitioner_id: 1, first_name: 'Aiden', last_name: 'Holt', role: 'practitioner', created_at: '2026-10-14T10:00:00Z' },
          { id: 'batch-indep-02', practitioner_id: 2, first_name: 'Nora', last_name: 'Diaz', role: 'independent_practitioner', created_at: '2026-10-13T10:00:00Z' },
        ],
      })
      .mockResolvedValueOnce({ // lines for batch-agency-01
        rows: [{ id: 10, billing_batch_id: 'batch-agency-01', total_time: 60, pay_rate: '50.00', practitioner_id: 1, role: 'practitioner' }],
      })
      .mockResolvedValueOnce({ // lines for batch-indep-02
        rows: [{ id: 20, billing_batch_id: 'batch-indep-02', total_time: 60, pay_rate: '60.00', practitioner_id: 2, role: 'independent_practitioner' }],
      });
    loadComplianceForLines.mockResolvedValue(new Map());
    deriveEimsStatus.mockReturnValue({ tier: 'cleared' });

    await getDocumentsFeed(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.documents[0]).toMatchObject({ documentType: 'invoice', practitionerName: 'Aiden Holt', sessionCount: 1, amount: 50 });
    expect(payload.documents[1]).toMatchObject({ documentType: 'sevf', practitionerName: 'Nora Diaz', sessionCount: 1, amount: 60 });
  });

  test('"worst wins": one exception line among cleared lines makes the whole batch mismatch', async () => {
    const req = {};
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'batch-1', practitioner_id: 1, first_name: 'A', last_name: 'B', role: 'practitioner', created_at: '2026-10-14T10:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 10, billing_batch_id: 'batch-1', total_time: 60, pay_rate: '50.00', practitioner_id: 1, role: 'practitioner' },
        { id: 11, billing_batch_id: 'batch-1', total_time: 60, pay_rate: '50.00', practitioner_id: 1, role: 'practitioner' },
      ] });
    loadComplianceForLines.mockResolvedValue(new Map());
    deriveEimsStatus
      .mockReturnValueOnce({ tier: 'cleared' })
      .mockReturnValueOnce({ tier: 'exception' });

    await getDocumentsFeed(req, res);

    expect(res.json.mock.calls[0][0].documents[0].status).toBe('mismatch');
  });

  test('a batch with zero assessment lines returns 0 sessions / $0.00 / pending, no crash', async () => {
    const req = {};
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'batch-empty', practitioner_id: 1, first_name: 'A', last_name: 'B', role: 'practitioner', created_at: '2026-10-14T10:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] });
    loadComplianceForLines.mockResolvedValue(new Map());

    await getDocumentsFeed(req, res);

    expect(res.json.mock.calls[0][0].documents[0]).toMatchObject({ sessionCount: 0, amount: 0, status: 'pending' });
  });
});
