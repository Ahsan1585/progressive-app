jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { requireConsentAccess } = require('../consentAccess');

const mkReq = ({ role = 'practitioner', isAdmin = false, permissions = [], id = '42', practitionerId = 7 } = {}) => ({
  practitioner: { role, practitionerId },
  isAdmin,
  permissions: new Set(permissions),
  params: { id },
});
const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

afterEach(() => jest.resetAllMocks());

describe('requireConsentAccess bad patient id', () => {
  test.each(['abc', '1 OR 1=1', '-3', '99999999999'])('404 (not 500) for %p, without querying', async (id) => {
    for (const who of [{ role: 'ceo', isAdmin: true }, { role: 'practitioner' }]) {
      const next = jest.fn();
      const res = mkRes();
      await requireConsentAccess(mkReq({ ...who, id }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('requireConsentAccess (consent endpoints authorization matrix)', () => {
  test('admin may act on any child (only checks the child exists)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const next = jest.fn();
    const res = mkRes();
    await requireConsentAccess(mkReq({ role: 'ceo', isAdmin: true }), res, next);
    expect(next).toHaveBeenCalled();
    expect(pool.query.mock.calls[0][0]).not.toMatch(/patient_practitioners/);
  });

  test('admin gets 404 for a child that does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const next = jest.fn();
    const res = mkRes();
    await requireConsentAccess(mkReq({ role: 'ceo', isAdmin: true }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('a role holding patient_record_rights may act on any child', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const next = jest.fn();
    await requireConsentAccess(mkReq({ role: 'office_manager', permissions: ['patient_record_rights'] }), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('an agency practitioner is refused even for a child on their own caseload (consents are the office\'s job)', async () => {
    const next = jest.fn();
    const res = mkRes();
    await requireConsentAccess(mkReq({ role: 'practitioner' }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('an agency practitioner who was also given patient_record_rights is the office, so they may act', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const next = jest.fn();
    await requireConsentAccess(mkReq({ role: 'practitioner', permissions: ['patient_record_rights'] }), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('an independent practitioner keeps access to their own child (their own ownership query)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const next = jest.fn();
    await requireConsentAccess(mkReq({ role: 'independent_practitioner' }), mkRes(), next);
    expect(next).toHaveBeenCalled();
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/patient_practitioners/);
    expect(params).toEqual(['42', 7]);
  });

  test("an independent practitioner gets 403 for a child that is not theirs", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const next = jest.fn();
    const res = mkRes();
    await requireConsentAccess(mkReq({ role: 'independent_practitioner' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a reassigned-away independent practitioner gets 403 (the ownership query excludes reassigned rows)', async () => {
    // The DB applies the exclusion; the row for a reassigned practitioner is
    // filtered out, so the query comes back empty.
    pool.query.mockResolvedValueOnce({ rows: [] });
    const next = jest.fn();
    const res = mkRes();
    await requireConsentAccess(mkReq({ role: 'independent_practitioner', practitionerId: 9 }), res, next);
    expect(pool.query.mock.calls[0][0]).toContain("deactivated_reason IS DISTINCT FROM 'reassigned'");
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('office staff without patient_record_rights get 403 without any lookup', async () => {
    const next = jest.fn();
    const res = mkRes();
    await requireConsentAccess(mkReq({ role: 'billing_staff', permissions: ['staff_directory_view'] }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('a DB error is passed to next(err), never treated as allowed', async () => {
    const err = new Error('boom');
    pool.query.mockRejectedValueOnce(err);
    const next = jest.fn();
    await requireConsentAccess(mkReq({ role: 'independent_practitioner' }), mkRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
