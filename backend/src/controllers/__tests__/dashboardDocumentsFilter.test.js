// getDocumentsFeed: ?practitionerId= scopes the batches query — this
// endpoint gets the filter only, no hours companion (per spec: a document
// is a file, not a countable duration).
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/invoiceData', () => ({
  loadComplianceBatched: jest.fn().mockResolvedValue(new Map()),
  deriveEimsStatus: jest.fn(),
  formatInvoiceNumber: (id) => `INV-${String(id).slice(0, 8).toUpperCase()}`,
}));

const { pool } = require('../../config/db');
const { getDocumentsFeed } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('getDocumentsFeed practitioner filter', () => {
  test('the batches query binds practitionerId', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getDocumentsFeed({ query: { practitionerId: '8' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const [call] = pool.query.mock.calls.filter(([sql]) => /FROM billing_batches bb/.test(sql));
    expect(call[0]).toMatch(/bb\.practitioner_id = \$3/);
    expect(call[1]).toContain(8);
  });
});
