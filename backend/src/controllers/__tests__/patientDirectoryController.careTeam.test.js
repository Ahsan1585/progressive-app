jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));

const { pool } = require('../../config/db');
const {
  listDirectoryPatients,
  addDirectoryPatientPractitioner,
  removeDirectoryPatientPractitioner,
} = require('../patientDirectoryController');

afterEach(() => jest.resetAllMocks());

// Staff Directory > All Children was only ever showing ONE practitioner per
// child (activePractitioner() in StaffDirectoryChildren.jsx picks the first
// active row) even when a child has multiple active practitioners — hiding
// the rest of the care team and giving no visibility into discipline.
// position_title (e.g. "OT", "PT") is the practitioner's actual discipline
// label — not service_types, which is the list of billable service
// categories they're registered to log (Developmental Intervention, IFSP
// Meeting, etc.) and reads as noise in a care-team chip.
describe('listDirectoryPatients includes position_title per practitioner', () => {
  test('each practitioner entry carries position_title so the UI can show discipline', async () => {
    const req = {};
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, first_name: 'Abigail', last_name: 'Barrett',
        practitioners: [{ id: 5, first_name: 'Sophia', last_name: 'Reed', status: 'active', position_title: 'OT' }],
      }],
    });

    await listDirectoryPatients(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('position_title'));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// Co-assigning a practitioner must not disturb anyone else already on the
// child's team — unlike reassignDirectoryPatientPractitioner, which
// deliberately replaces the whole team with one practitioner.
describe('addDirectoryPatientPractitioner', () => {
  test('inserts/reactivates the practitioner as active without touching other rows', async () => {
    const req = { params: { id: '42' }, body: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] }) // patient exists
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // practitioner exists
      .mockResolvedValueOnce({ rows: [] }); // INSERT ... ON CONFLICT

    await addDirectoryPatientPractitioner(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("VALUES ($1, $2, 'active', NULL)"),
      ['42', 7]
    );
    // Critically: no call touches any OTHER practitioner_id for this patient.
    const otherPractitionerCalls = pool.query.mock.calls.filter(
      ([sql]) => sql.includes('practitioner_id !=')
    );
    expect(otherPractitionerCalls).toHaveLength(0);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  test('404s when the child does not exist', async () => {
    const req = { params: { id: '42' }, body: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await addDirectoryPatientPractitioner(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('404s when the practitioner does not exist', async () => {
    const req = { params: { id: '42' }, body: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '42' }] })
      .mockResolvedValueOnce({ rows: [] });

    await addDirectoryPatientPractitioner(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400s when practitionerId is missing', async () => {
    const req = { params: { id: '42' }, body: {} };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await addDirectoryPatientPractitioner(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// Removing one co-practitioner must leave every other practitioner's row
// on this child untouched — same deactivated_reason = 'reassigned' marker
// the office-reassignment flow uses (FERPA §303.404: that practitioner's
// access to this child must end immediately).
describe('removeDirectoryPatientPractitioner', () => {
  test('sets only the targeted practitioner inactive/reassigned', async () => {
    const req = { params: { id: '42', practitionerId: '7' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [{ patient_id: '42' }] }); // UPDATE ... RETURNING

    await removeDirectoryPatientPractitioner(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("deactivated_reason = 'reassigned'"),
      ['42', '7']
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  test('404s when the practitioner is not actively assigned to this child', async () => {
    const req = { params: { id: '42', practitionerId: '7' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await removeDirectoryPatientPractitioner(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
