// rejectLog ('type: return' -> billing_status: 'rejected') previously left
// acknowledged_at untouched. If a log was acknowledged once (e.g. it was
// 'declined' and the practitioner acknowledged it, or any other path that
// set acknowledged_at) and billing later returns it again, the fresh
// 'rejected' row still has acknowledged_at set from the stale prior
// acknowledgment — so getRejectedLogs's `AND acknowledged_at IS NULL` filter
// silently excludes it from the practitioner's Inbox, even though it's a
// brand new rejection they need to see and resubmit. The practitioner's
// home banner (agencyPractitionerSummary, which has no such filter) still
// shows it as returned, and the office's Pending Bills still shows it as
// returned too — so the log is stuck, visible everywhere except the one
// place that lets the practitioner actually act on it.
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/tenantContext', () => ({
  getCurrentTenantDb: jest.fn(() => 'test-tenant'),
}));
jest.mock('../../constants/dropdownOptionsCache', () => ({
  getDropdownOptionsCache: jest.fn(() => ({})),
  getDropdownCategoriesCache: jest.fn(() => []),
}));

const { pool } = require('../../config/db');
const { rejectLog } = require('../billingController');

function mockReqRes(body = {}) {
  const req = { body, practitioner: { practitionerId: 3, role: 'billing_specialist' } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}

afterEach(() => pool.query.mockReset());

describe('rejectLog clears a stale acknowledged_at', () => {
  it("returning a log (type: 'return') clears acknowledged_at in the same UPDATE", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ billing_status: 'declined' }] }) // isAwaitingResign lookup
      .mockResolvedValueOnce({ rows: [{ rejection_count: 1 }] }) // rejection_count lookup
      .mockResolvedValueOnce({ rows: [] }) // the UPDATE itself
      .mockResolvedValueOnce({ rows: [] }); // assessment_notes insert

    const { req, res } = mockReqRes({ assessmentId: 42, note: 'Please fix the date', type: 'return' });
    await rejectLog(req, res);

    expect(res.body).toEqual({ success: true });
    const updateCall = pool.query.mock.calls[2];
    expect(updateCall[0]).toMatch(/acknowledged_at\s*=\s*NULL/i);
  });

  it("permanently declining a log (type: 'reject') also clears acknowledged_at", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ billing_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ rejection_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes({ assessmentId: 43, note: 'Not billable', type: 'reject' });
    await rejectLog(req, res);

    const updateCall = pool.query.mock.calls[2];
    expect(updateCall[0]).toMatch(/acknowledged_at\s*=\s*NULL/i);
  });
});
