process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { decryptField } = require('../fieldEncryption');
const { createAssessmentFromPayload } = require('../createAssessment');

afterEach(() => jest.resetAllMocks());

describe('createAssessmentFromPayload', () => {
  it('encrypts patient_first_name, patient_last_name, patient_dob, session_notes and sets the blind index', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // findConflictingSession
      .mockResolvedValueOnce({ rows: [{ id: 99 }] }); // INSERT ... RETURNING *

    await createAssessmentFromPayload({
      patientId: 5, practitionerId: 3,
      patient_first_name: 'Luz', patient_last_name: 'Quintero', patient_dob: '2024-03-05', patient_county: 'Essex',
      practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy', practitioner_discipline: 'PT',
      date: '2026-10-29', startTime: '10:00', endTime: '11:00', totalTime: 60,
      status: '1', type: 'PT', location: '1', groupSizeCategory: null,
      parentSignatureBase64: 'data:a', practitionerSignatureBase64: 'data:b',
      sanitizedCustomFields: {}, note: 'Worked on stacking rings.',
    });

    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO assessments/.test(sql));
    const [sql, params] = insertCall;
    const colList = sql.match(/\(([^)]+)\)/)[1].split(',').map((s) => s.trim());
    const get = (col) => params[colList.indexOf(col)];

    expect(decryptField(get('patient_first_name'))).toBe('Luz');
    expect(decryptField(get('patient_last_name'))).toBe('Quintero');
    expect(decryptField(get('patient_dob'))).toBe('2024-03-05');
    expect(decryptField(get('session_notes'))).toBe('Worked on stacking rings.');
    expect(get('patient_first_name_idx')).toBeTruthy();
    expect(get('patient_last_name_idx')).toBeTruthy();
  });
});
