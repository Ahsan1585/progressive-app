process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

const { decryptField, hmacIndex } = require('../../utils/fieldEncryption');
const { insertAgency } = require('../loadAgency');

function makeClientStub() {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (/INSERT INTO practitioners/.test(sql)) return { rows: [{ id: calls.filter(([s]) => /INSERT INTO practitioners/.test(s)).length }] };
      if (/INSERT INTO patients/.test(sql)) return { rows: [{ id: calls.filter(([s]) => /INSERT INTO patients/.test(s)).length }] };
      if (/INSERT INTO patient_practitioners/.test(sql)) return { rows: [] };
      if (/INSERT INTO assessments/.test(sql)) {
        const rowCount = sql.match(/VALUES\s+(\(.*?\))(?:,\s*\(.*?\))*$/s);
        const n = (sql.match(/\(\$/g) || []).length;
        return { rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) };
      }
      return { rows: [] };
    }),
  };
}

const oneProviderOneChildOneSessionAgency = () => ({
  providers: [{
    key: 'p1', firstName: 'Omar', lastName: 'Abernathy', email: 'omar@example.com',
    positionTitle: 'PT', payRate: 40, discipline: 'PT', endDate: null, hireDate: '2026-01-01',
    errorProfile: { mix: { missing_in_eims: 0 } },
  }],
  children: [{
    key: 'c1', firstName: 'Luz', lastName: 'Quintero', dob: '2024-03-05', county: 'Essex',
    childId: 'CH-1', endDate: null, parentName: 'Rosa Quintero', parentEmail: 'rosa@example.com',
    startDate: '2026-01-01', team: [],
  }],
  sessions: [{
    childKey: 'c1', providerKey: 'p1', serviceDate: '2026-02-01', endTime: '11:00',
    totalMinutes: 30, visitStatus: '1', signatureIssue: null,
    logged: { startTime: '10:30', endTime: '11:00', serviceCode: 'PT', location: '1' },
    serviceCode: 'PT', location: '1', groupSize: null, notes: 'Worked on stacking rings.',
  }],
});

describe('insertAgency seeding writes encrypted patient identity fields', () => {
  it('stores child first_name/last_name/dob encrypted in the patients INSERT, with HMAC index', async () => {
    const client = makeClientStub();
    await insertAgency(client, oneProviderOneChildOneSessionAgency());

    const patientsCall = client.calls.find(([sql]) => /INSERT INTO patients/.test(sql));
    const [, params] = patientsCall;
    expect(params[0]).not.toBe('Luz');
    expect(decryptField(params[0])).toBe('Luz');
    expect(decryptField(params[1])).toBe('Quintero');
    expect(decryptField(params[2])).toBe('2024-03-05');
    expect(params[9]).toBe(hmacIndex('Luz'));
    expect(params[10]).toBe(hmacIndex('Quintero'));
  });

  it('stores session patient_first_name/patient_last_name/patient_dob/session_notes encrypted, with HMAC index', async () => {
    const client = makeClientStub();
    await insertAgency(client, oneProviderOneChildOneSessionAgency());

    const assessmentsCall = client.calls.find(([sql]) => /INSERT INTO assessments/.test(sql));
    const [sql, params] = assessmentsCall;
    const colList = sql.match(/\(([^)]+)\)\s+VALUES/)[1].split(',').map((s) => s.trim());
    const get = (col) => params[colList.indexOf(col)];

    expect(decryptField(get('patient_first_name'))).toBe('Luz');
    expect(decryptField(get('patient_last_name'))).toBe('Quintero');
    expect(decryptField(get('patient_dob'))).toBe('2024-03-05');
    expect(decryptField(get('session_notes'))).toBe('Worked on stacking rings.');
    expect(get('patient_first_name_idx')).toBe(hmacIndex('Luz'));
    expect(get('patient_last_name_idx')).toBe(hmacIndex('Quintero'));
  });
});
