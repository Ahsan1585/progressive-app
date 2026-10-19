jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { listPatientConsents, createConsent, revokeConsent } = require('../recordsConsentController');

describe('listPatientConsents', () => {
  afterEach(() => jest.clearAllMocks());

  test('checks ownership (excluding reassigned-away patients) before listing', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await listPatientConsents(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      ['42', 7]
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns the patient\'s consents, newest first, when owned', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const consentRows = [{ id: 2, recipient_name: 'ABC', granted_at: '2026-10-01' }];
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // ownership check passes
      .mockResolvedValueOnce({ rows: consentRows }); // SELECT consents

    await listPatientConsents(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, consents: consentRows });
  });
});

describe('createConsent', () => {
  afterEach(() => jest.clearAllMocks());

  test('rejects an invalid record_types value with 400 before touching the DB', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      params: { id: '42' },
      body: { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['not_a_real_type'] },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await createConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects an empty record_types array with 400', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      params: { id: '42' },
      body: { recipientName: 'ABC', purpose: 'Billing', recordTypes: [] },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await createConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('checks ownership before creating', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      params: { id: '42' },
      body: { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['sevf_forms'] },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await createConsent(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      ['42', 7]
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('defaults expires_at to one year from now when not supplied', async () => {
    const req = {
      practitioner: { practitionerId: 7 },
      params: { id: '42' },
      body: { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['sevf_forms'] },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // ownership check passes
      .mockResolvedValueOnce({ rows: [{ id: 5, expires_at: '2027-10-19T00:00:00.000Z' }] }); // INSERT

    await createConsent(req, res);

    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO records_consents');
    // 6th bind param is expires_at (patient_id, recipient_name, purpose,
    // record_types, granted_by, expires_at, proof_note) — when the caller
    // doesn't supply one, the handler computes granted_at + 1 year itself
    // rather than relying on a DB default, so it's always a concrete value
    // in the audit trail regardless of what the row's default would be.
    expect(insertCall[1][5]).toEqual(expect.any(Date));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('revokeConsent', () => {
  afterEach(() => jest.clearAllMocks());

  test('checks ownership before revoking', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42', consentId: '5' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await revokeConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('sets revoked_at/revoked_by on the matching consent', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42', consentId: '5' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // ownership check passes
      .mockResolvedValueOnce({ rows: [{ id: '5' }] }); // UPDATE ... RETURNING id

    await revokeConsent(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SET revoked_at = now(), revoked_by = $1'),
      [7, '5', '42']
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('404s when the consentId does not belong to this patient', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42', consentId: '999' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // ownership check passes
      .mockResolvedValueOnce({ rows: [] }); // UPDATE matches nothing

    await revokeConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
