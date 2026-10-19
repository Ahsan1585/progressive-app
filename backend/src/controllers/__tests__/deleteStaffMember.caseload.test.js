jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../middleware/tenantMiddleware', () => ({ lookupCompanyBySlug: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendInviteEmail: jest.fn(),
}));
jest.mock('../../utils/fieldEncryption', () => ({ encryptField: jest.fn((v) => v), decryptField: jest.fn((v) => v) }));

const { pool } = require('../../config/db');
const authController = require('../authController');

// Deactivating a practitioner must immediately clear their caseload — the
// children they're assigned to stay silently pointing at someone who can
// no longer log in or act on them otherwise. Marked deactivated_reason =
// 'reassigned' (same marker the office-reassignment flow uses), so those
// children show as Unassigned in All Children and every ownership-check
// query (see the FERPA §303.404 revocation fix) already treats them as no
// longer belonging to this practitioner. On reactivation, caseload is NOT
// restored automatically — by then the office may have already reassigned
// those children elsewhere.
describe('deleteStaffMember clears the caseload on deactivation', () => {
  // resetAllMocks — pool.query is a plain jest.fn() (not a spy), so neither
  // clearAllMocks (only clears call history) nor restoreAllMocks (only
  // restores jest.spyOn spies) clears a queued-but-unconsumed
  // mockResolvedValueOnce from a test that returned on an earlier branch
  // than expected; that leftover value would otherwise leak into the next
  // test's first call. resetAllMocks clears both the implementation queue
  // and call history.
  afterEach(() => jest.resetAllMocks());

  function makeReqRes({ requesterId = 1, requesterRole = 'ceo', targetId = '42' } = {}) {
    const req = {
      params: { id: targetId },
      practitioner: { practitionerId: requesterId, role: requesterRole },
      isAdmin: true, // set by loadPermissions middleware for a ceo/admin caller
      permissions: new Set(),
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    return { req, res };
  }

  test('clears the target practitioner\'s caseload (status + deactivated_reason) after deactivating them', async () => {
    const { req, res } = makeReqRes();
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'practitioner' }] }) // target role lookup
      .mockResolvedValueOnce({ rows: [{ admin_count: '2' }] }) // isLastActiveAdmin count query
      .mockResolvedValueOnce({ rows: [] }) // UPDATE practitioners SET is_active = false
      .mockResolvedValueOnce({ rows: [] }); // UPDATE patient_practitioners (clear caseload)

    await authController.deleteStaffMember(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      "UPDATE patient_practitioners SET status = 'inactive', deactivated_reason = 'reassigned' WHERE practitioner_id = $1 AND status = 'active'",
      ['42']
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('does not touch patient_practitioners when deactivation is blocked (last active admin)', async () => {
    const { req, res } = makeReqRes({ targetId: '99' });
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'ceo' }] }) // target role lookup
      .mockResolvedValueOnce({ rows: [{ admin_count: '1' }] }); // isLastActiveAdmin -> true (only one left)

    await authController.deleteStaffMember(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const caseloadCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('patient_practitioners'));
    expect(caseloadCalls).toHaveLength(0);
  });
});
