process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { encryptField, hmacIndex, decryptField } = require('../../utils/fieldEncryption');
const { registerPatient, getPatients, updatePatient } = require('../patientController');

function mockReqRes(body = {}, params = {}) {
  const req = { body, params, practitioner: { practitionerId: 3 } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}

afterEach(() => jest.resetAllMocks());

describe('registerPatient', () => {
  it('stores first_name/last_name/dob encrypted and their HMAC index alongside', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // existing child_id check: none found
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero'), dob: encryptField('2024-03-05') }] }) // INSERT ... RETURNING *
      .mockResolvedValueOnce({ rows: [] }); // patient_practitioners insert

    const { req, res } = mockReqRes({
      firstName: 'Luz', lastName: 'Quintero', dob: '2024-03-05', county: 'Essex', childId: '123456789',
    });
    await registerPatient(req, res);

    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO patients/.test(sql));
    const [, params] = insertCall;
    expect(params[0]).not.toBe('Luz'); // first_name param is ciphertext, not plaintext
    expect(decryptField(params[0])).toBe('Luz');
    expect(decryptField(params[2])).toBe('Quintero'); // last_name
    expect(decryptField(params[3])).toBe('2024-03-05'); // dob
  });
});

describe('getPatients', () => {
  it('returns decrypted plaintext names/dob, not ciphertext, and strips the index columns', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero'),
        middle_name: null, dob: encryptField('2024-03-05'),
        first_name_idx: hmacIndex('Luz'), last_name_idx: hmacIndex('Quintero'),
        status: 'active',
      }],
    });
    const { req, res } = mockReqRes();
    await getPatients(req, res);

    expect(res.body[0].first_name).toBe('Luz');
    expect(res.body[0].last_name).toBe('Quintero');
    expect(res.body[0].dob).toBe('2024-03-05');
    expect(res.body[0]).not.toHaveProperty('first_name_idx');
    expect(res.body[0]).not.toHaveProperty('last_name_idx');
  });

  it('sorts the returned list alphabetically by last_name in application code', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, first_name: encryptField('Zoe'), last_name: encryptField('Yang'), dob: encryptField('2023-01-01'), status: 'active' },
        { id: 2, first_name: encryptField('Amy'), last_name: encryptField('Alpha'), dob: encryptField('2023-01-01'), status: 'active' },
      ],
    });
    const { req, res } = mockReqRes();
    await getPatients(req, res);
    expect(res.body.map((p) => p.last_name)).toEqual(['Alpha', 'Yang']);
  });
});

describe('updatePatient', () => {
  it('stores updated first_name/last_name/dob encrypted with a refreshed HMAC index', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero-Reyes'), dob: encryptField('2024-03-05') }] }); // UPDATE ... RETURNING *

    const { req, res } = mockReqRes(
      { firstName: 'Luz', lastName: 'Quintero-Reyes', dob: '2024-03-05', county: 'Essex', childId: '123456789' },
      { id: '5' }
    );
    await updatePatient(req, res);

    const updateCall = pool.query.mock.calls.find(([sql]) => /UPDATE patients/.test(sql));
    const [, params] = updateCall;
    expect(decryptField(params[2])).toBe('Quintero-Reyes'); // last_name param position
  });
});
