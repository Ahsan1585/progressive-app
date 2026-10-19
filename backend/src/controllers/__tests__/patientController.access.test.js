jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { getPatients, updatePatient, getPatientAssessments, updatePatientStatus } = require('../patientController');
const { reassignDirectoryPatientPractitioner } = require('../patientDirectoryController');

// FERPA/IDEA Part C §303.404 — access revocation must be immediate. A
// practitioner reassigned off a case (patient_practitioners.deactivated_reason
// = 'reassigned') must lose read/write access to that child on their very
// next request, not just after re-login. A practitioner's own self-discharge
// toggle (deactivated_reason = 'discharged') is a different, intentional
// clinical state and must NOT revoke their own access — see
// updatePatientStatus's own test file for that write path.
describe('patient ownership checks exclude reassigned-away patients', () => {
  afterEach(() => jest.clearAllMocks());

  test('getPatients query filters out rows reassigned away from this practitioner', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getPatients(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      [7]
    );
  });

  test('updatePatient ownership check excludes a reassigned-away patient', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' }, body: {} };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 404

    await updatePatient(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      ['42', 7]
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('getPatientAssessments ownership check excludes a reassigned-away patient', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check finds nothing -> 403

    await getPatientAssessments(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason IS DISTINCT FROM 'reassigned'"),
      ['42', 7]
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('deactivated_reason is set correctly by each write path', () => {
  afterEach(() => jest.clearAllMocks());

  test('a practitioner discharging their own patient sets deactivated_reason to discharged, not reassigned', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' }, body: { status: 'inactive' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ patient_id: '42' }] }) // UPDATE ... RETURNING patient_id
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }); // SELECT * FROM patients

    await updatePatientStatus(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("'discharged'"),
      ['inactive', '42', 7]
    );
  });

  test('reactivating a patient clears deactivated_reason', async () => {
    const req = { practitioner: { practitionerId: 7 }, params: { id: '42' }, body: { status: 'active' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ patient_id: '42' }] })
      .mockResolvedValueOnce({ rows: [{ id: '42' }] });

    await updatePatientStatus(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ELSE NULL END'),
      ['active', '42', 7]
    );
  });

  test('office reassignment sets the old practitioner\'s deactivated_reason to reassigned', async () => {
    const req = { params: { id: '42' }, body: { practitionerId: 99 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // patient exists
      .mockResolvedValueOnce({ rows: [{ id: 99 }] }) // new practitioner exists
      .mockResolvedValueOnce({ rows: [] }) // UPDATE old practitioners' rows -> inactive/reassigned
      .mockResolvedValueOnce({ rows: [] }); // INSERT/UPDATE new practitioner -> active/NULL

    await reassignDirectoryPatientPractitioner(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("deactivated_reason = 'reassigned'"),
      ['inactive', '42', 99]
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("deactivated_reason = NULL"),
      ['42', 99]
    );
  });
});
