process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/fakeSignature', () => ({ generateSignaturePng: jest.fn(() => 'data:image/png;base64,fake') }));
const { pool } = require('../../config/db');
const { encryptField, decryptField, hmacIndex } = require('../../utils/fieldEncryption');

function mockReqRes(body = {}) {
  const req = { body, practitioner: { practitionerId: 1 } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req, res };
}

function route(handlers) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    for (const [re, result] of handlers) if (re.test(sql)) return typeof result === 'function' ? result(params) : result;
    return { rows: [] };
  };
  return { fn, calls, find: (re) => calls.filter((c) => re.test(c.sql)) };
}
function useClient(r) {
  const client = { query: jest.fn(r.fn), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  return client;
}

afterEach(() => jest.resetAllMocks());

describe('test-data tooling tag matching against encrypted session_notes', () => {
  it('refreshGeneratedSignatures finds rows tagged [GENSEPT26] by decrypting and matching in Node, not via SQL LIKE', async () => {
    const { refreshGeneratedSignatures } = require('../testDataController');
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { id: 1, session_notes: encryptField('[GENSEPT26] auto-generated') },
          { id: 2, session_notes: encryptField('A real clinical note') },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // the UPDATE for row 1's signatures
    const { req, res } = mockReqRes();
    await refreshGeneratedSignatures(req, res);

    expect(res.body.assessmentsUpdated).toBe(1);
    const [firstCallSql] = pool.query.mock.calls[0];
    expect(firstCallSql).not.toMatch(/LIKE '\[GENSEPT26\]/);
  });

  it('backfillGeneratedCompletedAt filters tagged rows in Node before the UPDATE', async () => {
    const { backfillGeneratedCompletedAt } = require('../testDataController');
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { id: 1, session_notes: encryptField('[GENSEPT26] auto-generated') },
          { id: 2, session_notes: encryptField('A real clinical note') },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const { req, res } = mockReqRes();
    await backfillGeneratedCompletedAt(req, res);

    expect(res.body.updated).toBe(1);
    const updateCall = pool.query.mock.calls.find(([sql]) => /UPDATE assessments/.test(sql));
    expect(updateCall[1][0]).toEqual([1]);
  });

  it('wipeGeneratedLiveSessions finds GEN_TAG rows by decrypting and matching in Node', async () => {
    const { wipeGeneratedLiveSessions } = require('../testDataController');
    const r = route([
      [/SELECT id, session_notes FROM assessments/, { rows: [
        { id: 1, session_notes: encryptField('[GENSEPT26] a live-generated session') },
        { id: 2, session_notes: encryptField('A real clinical note') },
      ] }],
    ]);
    useClient(r);
    const { req, res } = mockReqRes();
    await wipeGeneratedLiveSessions(req, res);

    expect(res.body.removed).toBe(1);
    const deleteCall = r.find(/DELETE FROM assessments WHERE id/)[0];
    expect(deleteCall.params).toEqual([[1]]);
  });
});

describe('test-data seeding writes encrypted patient identity', () => {
  it('seedComparisonTestData stores first_name/last_name/dob/patient identity encrypted with a blind index', async () => {
    const { seedComparisonTestData } = require('../testDataController');
    const r = route([
      [/SELECT id FROM practitioners WHERE email/, { rows: [] }],
      [/INSERT INTO practitioners/, { rows: [{ id: 3 }] }],
      [/INSERT INTO patients/, { rows: [] }],
      [/SELECT id FROM patients WHERE child_id/, { rows: [{ id: 5 }] }],
      [/INSERT INTO patient_practitioners/, { rows: [] }],
      [/INSERT INTO assessments/, { rows: [{ id: 1 }] }],
    ]);
    useClient(r);

    const { req, res } = mockReqRes({
      practitioners: [{ firstName: 'Omar', lastName: 'Abernathy', email: 'omar@example.com' }],
      children: [{ firstName: 'Luz', lastName: 'Quintero', dob: '2024-03-05', childId: 'CH-1', county: 'Essex' }],
      sessions: [{ childId: 'CH-1', practitionerEmail: 'omar@example.com', serviceDate: '2026-10-01', discipline: 'Physical Therapy', visitStatus: 'Direct Child Service' }],
    });
    await seedComparisonTestData(req, res);

    const patientsInsert = r.find(/INSERT INTO patients/)[0];
    expect(decryptField(patientsInsert.params[0])).toBe('Luz');
    expect(decryptField(patientsInsert.params[1])).toBe('Quintero');
    expect(decryptField(patientsInsert.params[2])).toBe('2024-03-05');
    expect(patientsInsert.params[5]).toBe(hmacIndex('Luz'));
    expect(patientsInsert.params[6]).toBe(hmacIndex('Quintero'));

    const assessmentsInsert = r.find(/INSERT INTO assessments/)[0];
    expect(decryptField(assessmentsInsert.params[2])).toBe('Luz');
    expect(decryptField(assessmentsInsert.params[3])).toBe('Quintero');
    expect(decryptField(assessmentsInsert.params[4])).toBe('2024-03-05');
  });

  it('createDummyRoster stores first_name/last_name/dob encrypted with a blind index', async () => {
    const { createDummyRoster } = require('../testDataController');
    const r = route([
      [/INSERT INTO practitioners/, { rows: [{ id: 3 }] }],
      [/INSERT INTO patients/, { rows: [{ id: 5 }] }],
    ]);
    useClient(r);
    const { req, res } = mockReqRes({ practitionerCount: 1, patientCount: 1 });
    await createDummyRoster(req, res);

    const patientsInserts = r.find(/INSERT INTO patients/);
    expect(patientsInserts).toHaveLength(1);
    const patientsInsert = patientsInserts[0];
    const firstName = decryptField(patientsInsert.params[0]);
    const lastName = decryptField(patientsInsert.params[1]);
    expect(firstName).toBeTruthy();
    expect(lastName).toBeTruthy();
    expect(patientsInsert.params[0]).not.toBe(firstName);
    // The index must be derived from the SAME name actually stored, so a
    // later exact-match lookup for this patient by name succeeds.
    expect(hmacIndex(firstName)).toBe(patientsInsert.params[5]);
    expect(hmacIndex(lastName)).toBe(patientsInsert.params[6]);
  });
});

describe('anonymization rename utility encrypts the new fake names it writes', () => {
  it('stores the randomized replacement first_name/last_name encrypted on both patients and assessments, with a refreshed blind index', async () => {
    const { anonymizeTenantRoster } = require('../testDataController');
    const r = route([
      [/SELECT id, first_name, last_name FROM practitioners/, { rows: [] }],
      [/SELECT id, first_name, last_name FROM patients/, { rows: [{ id: 5, first_name: encryptField('Luz'), last_name: encryptField('Quintero') }] }],
      [/UPDATE patients SET first_name/, { rows: [] }],
      [/UPDATE assessments SET patient_first_name/, { rows: [] }],
      [/UPDATE compliance_state_logs SET child_name/, { rows: [] }],
      [/UPDATE master_reports SET child_name/, { rows: [] }],
    ]);
    useClient(r);
    const { req, res } = mockReqRes();
    await anonymizeTenantRoster(req, res);

    expect(res.body.patientsRenamed).toBe(1);
    const patientsUpdate = r.find(/UPDATE patients SET first_name/)[0];
    const newFirst = decryptField(patientsUpdate.params[0]);
    const newLast = decryptField(patientsUpdate.params[1]);
    expect(patientsUpdate.params[0]).not.toBe(newFirst); // ciphertext, not plaintext
    expect(patientsUpdate.params[2]).toBe(hmacIndex(newFirst));
    expect(patientsUpdate.params[3]).toBe(hmacIndex(newLast));

    const assessmentsUpdate = r.find(/UPDATE assessments SET patient_first_name/)[0];
    expect(decryptField(assessmentsUpdate.params[0])).toBe(newFirst);
    expect(decryptField(assessmentsUpdate.params[1])).toBe(newLast);

    // The OLD name used to match compliance_state_logs/master_reports is
    // the DECRYPTED old name, not ciphertext — otherwise the WHERE
    // child_name = $2 comparison against those plaintext-free-text columns
    // would never match and the rename would silently fail to propagate.
    const stateLogUpdate = r.find(/UPDATE compliance_state_logs SET child_name/)[0];
    expect(stateLogUpdate.params[1]).toBe('Luz Quintero');
  });
});
