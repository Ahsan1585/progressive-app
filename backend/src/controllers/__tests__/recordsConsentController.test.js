jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { listPatientConsents, createConsent, revokeConsent } = require('../recordsConsentController');

// Authorization (admin / patient_record_rights / own caseload) is enforced
// by middleware/consentAccess.js before these handlers run — see
// middleware/__tests__/consentAccess.test.js.

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });
const yesterday = () => {
  const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};
const paper = () => ({ signedOn: yesterday(), paperAttested: true });

afterEach(() => jest.resetAllMocks());

describe('listPatientConsents', () => {
  test("returns the patient's consents (including source/signed_on/paper_attested), newest first", async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' } };
    const res = mkRes();
    const consentRows = [{ id: 2, recipient_name: 'ABC', granted_at: '2026-10-01', source: 'paper', signed_on: '2026-09-30', paper_attested: true }];
    pool.query.mockResolvedValueOnce({ rows: consentRows });

    await listPatientConsents(req, res);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM records_consents WHERE patient_id = \$1 ORDER BY granted_at DESC/);
    expect(params).toEqual(['42']);
    expect(res.json).toHaveBeenCalledWith({ success: true, consents: consentRows });
  });
});

describe('createConsent (paper path)', () => {
  const base = { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['sevf_forms'], identityVerifiedMethod: 'photo_id' };
  const mk = (extra = {}) => ({ practitioner: { practitionerId: 7 }, params: { id: '42' }, body: { ...base, ...paper(), ...extra } });

  test('rejects an invalid record_types value with 400 before touching the DB', async () => {
    const res = mkRes();
    await createConsent(mk({ recordTypes: ['not_a_real_type'] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects an empty record_types array with 400', async () => {
    const res = mkRes();
    await createConsent(mk({ recordTypes: [] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400 when signedOn is missing', async () => {
    const res = mkRes();
    await createConsent(mk({ signedOn: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/signedOn/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400 when signedOn is not a real calendar date', async () => {
    const res = mkRes();
    await createConsent(mk({ signedOn: '2026-02-30' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/signedOn/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400 when signedOn is in the future', async () => {
    const res = mkRes();
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await createConsent(mk({ signedOn: future }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/future/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400 when the paper-on-file attestation is missing or not exactly true', async () => {
    for (const paperAttested of [undefined, false, 'true', 1]) {
      const res = mkRes();
      await createConsent(mk({ paperAttested }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].error).toMatch(/paper consent is on file/i);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('defaults expires_at to one year from now when not supplied', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, expires_at: '2027-10-19T00:00:00.000Z' }] });
    await createConsent(mk(), res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO records_consents');
    // 7th bind param is expires_at
    expect(params[6]).toEqual(expect.any(Date));
    expect(params[6].getTime()).toBeGreaterThan(Date.now() + 360 * 24 * 60 * 60 * 1000);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('rejects an unparseable expiresAt with 400 before touching the DB', async () => {
    const res = mkRes();
    await createConsent(mk({ expiresAt: 'not-a-real-date' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects an expiresAt that is not in the future with 400', async () => {
    const res = mkRes();
    await createConsent(mk({ expiresAt: '2020-01-01T00:00:00.000Z' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('stores recipientEmail when supplied', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    await createConsent(mk({ recipientEmail: 'billing@abc.org' }), res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('recipient_email');
    expect(params).toContain('billing@abc.org');
  });

  test("stores source='paper', signed_on, paper_attested and granted_by", async () => {
    const res = mkRes();
    const signedOn = yesterday();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, record_types: ['sevf_forms'] }] });
    await createConsent(mk({ signedOn }), res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/source, signed_on, paper_attested/);
    expect(sql).toContain("'paper'");
    expect(params[5]).toBe(7); // granted_by
    expect(params).toContain(signedOn);
    expect(params[params.length - 1]).toBe(true);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('audits consent_paper_recorded with ids and counts only (no names/emails)', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, recipient_name: 'ABC', record_types: ['sevf_forms'] }] });
    await createConsent(mk({ recipientEmail: 'billing@abc.org' }), res);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent_paper_recorded', resourceType: 'patient', resourceId: '42',
      details: { consentId: 5, recordTypeCount: 1 },
    }));
    expect(JSON.stringify(logAudit.mock.calls[0][0].details)).not.toMatch(/ABC|abc\.org/);
  });
});

describe('createConsent identity verification (FERPA 99.30)', () => {
  const base = { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['sevf_forms'] };
  const mk = (extra) => ({ practitioner: { practitionerId: 7 }, params: { id: '42' }, body: { ...base, ...paper(), ...extra } });

  test('400 when identityVerifiedMethod is missing', async () => {
    const res = mkRes();
    await createConsent(mk({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/identityVerifiedMethod/);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('400 when method is invalid (electronic_dob is reserved for the e-sign flow)', async () => {
    for (const identityVerifiedMethod of ['trust_me', 'electronic_dob']) {
      const res = mkRes();
      await createConsent(mk({ identityVerifiedMethod }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
  test("400 when method is 'other' without a note", async () => {
    const res = mkRes();
    await createConsent(mk({ identityVerifiedMethod: 'other' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('stores method and note on insert', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    await createConsent(mk({ identityVerifiedMethod: 'other', identityVerifiedNote: ' checked w/ school ' }), res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('identity_verified_method');
    expect(params[8]).toBe('other');
    expect(params[9]).toBe('checked w/ school');
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('createConsent length limits (shared validation)', () => {
  const base = { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['sevf_forms'], identityVerifiedMethod: 'photo_id' };
  const mk = (extra) => ({ practitioner: { practitionerId: 7 }, params: { id: '42' }, body: { ...base, ...paper(), ...extra } });
  test.each([
    ['proofNote', { proofNote: 'x'.repeat(1001) }, /proofNote.*1000/],
    ['identityVerifiedNote', { identityVerifiedMethod: 'other', identityVerifiedNote: 'x'.repeat(1001) }, /identityVerifiedNote.*1000/],
    ['purpose', { purpose: 'x'.repeat(501) }, /purpose.*500/],
    ['expiry > 5 years', { expiresAt: new Date(Date.now() + 6 * 365 * 24 * 3600 * 1000).toISOString() }, /5 years/],
  ])('400 for an over-long/over-far %s, before touching the DB', async (_l, extra, re) => {
    const res = mkRes();
    await createConsent(mk(extra), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(re);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("a date-only expiresAt of today's NJ date is accepted", async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = mkRes();
    await createConsent(mk({ expiresAt: today }), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('bad ids are 404, never 500, and never reach the DB', () => {
  const body = { recipientName: 'ABC', purpose: 'Billing', recordTypes: ['sevf_forms'], identityVerifiedMethod: 'photo_id', ...paper() };
  test.each(['abc', '1; drop', '-1', '1.5', ''])('non-numeric patient id %p', async (id) => {
    for (const [fn, extra] of [[listPatientConsents, {}], [createConsent, { body }], [revokeConsent, { params: { id, consentId: '5' } }]]) {
      const res = mkRes();
      await fn({ practitioner: { practitionerId: 7 }, params: { id }, body: {}, ...extra }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each(['abc', '5x', '0', '99999999999999999999'])('invalid consentId %p on revoke', async (consentId) => {
    const res = mkRes();
    await revokeConsent({ practitioner: { practitionerId: 7 }, params: { id: '42', consentId } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('revokeConsent', () => {
  test('sets revoked_at/revoked_by on the matching consent', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42', consentId: '5' } };
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: '5' }] });

    await revokeConsent(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SET revoked_at = now(), revoked_by = $1'),
      [7, '5', '42']
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('404s when the consentId does not belong to this patient', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42', consentId: '999' } };
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [] });

    await revokeConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
