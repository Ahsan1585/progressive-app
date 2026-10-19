// Extends the deactivated_reason='reassigned' access-revocation fix (see
// patientController.access.test.js) to the 3 additional ownership-check
// sites found beyond the audit's original 3: scheduleController.js,
// sessionDraftsController.js, agencyController.js. FERPA/IDEA Part C
// §303.404 — access must end immediately once reassigned, not just for
// the original 3 endpoints.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');

describe('scheduleController ownership check excludes a reassigned-away patient', () => {
  afterEach(() => jest.clearAllMocks());

  test('createSession checks deactivated_reason before scheduling', async () => {
    const { createSession } = require('../scheduleController');
    const req = {
      practitioner: { practitionerId: 7 },
      body: { patientId: 42, sessionDate: '2099-01-01', startTime: '09:00', endTime: '10:00' },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // loadOwnedPatientAndPractitioner finds nothing -> 403

    await createSession(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      [42, 7]
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('sessionDraftsController ownership check excludes a reassigned-away patient', () => {
  afterEach(() => jest.clearAllMocks());

  test('saveDraft checks deactivated_reason before creating a draft', async () => {
    const { saveDraft } = require('../sessionDraftsController');
    const req = {
      practitioner: { practitionerId: 7 },
      body: { patientId: 42, formData: {} },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // assertOwnsPatient finds nothing -> 403

    await saveDraft(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      [42, 7]
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('agencyController ownership checks exclude a reassigned-away patient', () => {
  afterEach(() => jest.clearAllMocks());

  test('getPatientAgencies checks deactivated_reason before returning agencies', async () => {
    const { getPatientAgencies } = require('../agencyController');
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await getPatientAgencies(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      ['42', 7]
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('updatePatientAgencies checks deactivated_reason before writing', async () => {
    const { updatePatientAgencies } = require('../agencyController');
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' }, body: { agencyIds: [] } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await updatePatientAgencies(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      ['42', 7]
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('telepracticeSignatureController ownership check excludes a reassigned-away patient', () => {
  afterEach(() => jest.clearAllMocks());

  test('submitTelepracticeSession checks deactivated_reason before accepting a submission', async () => {
    const { submitTelepracticeSession } = require('../telepracticeSignatureController');
    const req = {
      practitioner: { practitionerId: 7 },
      body: { patientId: 42, practitionerSignatureBase64: 'data:image/png;base64,abc' },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // assertOwnsPatient finds nothing -> 403

    await submitTelepracticeSession(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      [42, 7]
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
