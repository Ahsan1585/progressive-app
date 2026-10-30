process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');
const { encryptField, decryptField, hmacIndex, decryptPatientRow, decryptAssessmentRow } = require('../fieldEncryption');

describe('hmacIndex', () => {
  it('returns null for null, undefined, and empty string without hashing', () => {
    expect(hmacIndex(null)).toBeNull();
    expect(hmacIndex(undefined)).toBeNull();
    expect(hmacIndex('')).toBeNull();
  });

  it('is deterministic and case/whitespace-insensitive', () => {
    expect(hmacIndex('Luz')).toBe(hmacIndex('luz'));
    expect(hmacIndex(' Luz ')).toBe(hmacIndex('luz'));
  });

  it('produces different digests for different names', () => {
    expect(hmacIndex('Luz')).not.toBe(hmacIndex('Omar'));
  });
});

describe('decryptPatientRow', () => {
  it('decrypts first_name, last_name, middle_name, dob and strips the index columns', () => {
    const row = {
      id: 1,
      first_name: encryptField('Luz'),
      last_name: encryptField('Quintero'),
      middle_name: encryptField('Marie'),
      dob: encryptField('2024-03-05'),
      first_name_idx: hmacIndex('Luz'),
      last_name_idx: hmacIndex('Quintero'),
      county: 'Essex',
    };
    const result = decryptPatientRow(row);
    expect(result.first_name).toBe('Luz');
    expect(result.last_name).toBe('Quintero');
    expect(result.middle_name).toBe('Marie');
    expect(result.dob).toBe('2024-03-05');
    expect(result.county).toBe('Essex');
    expect(result).not.toHaveProperty('first_name_idx');
    expect(result).not.toHaveProperty('last_name_idx');
  });

  it('returns null unchanged, not an error', () => {
    expect(decryptPatientRow(null)).toBeNull();
  });

  it('passes through plaintext rows unchanged (pre-backfill tolerance)', () => {
    const row = { id: 2, first_name: 'Plain', last_name: 'Name', dob: '2024-01-01' };
    const result = decryptPatientRow(row);
    expect(result.first_name).toBe('Plain');
    expect(result.dob).toBe('2024-01-01');
  });
});

describe('decryptAssessmentRow', () => {
  it('decrypts patient_first_name, patient_last_name, patient_dob, session_notes and strips index columns', () => {
    const row = {
      id: 9,
      patient_first_name: encryptField('Luz'),
      patient_last_name: encryptField('Quintero'),
      patient_dob: encryptField('2024-03-05'),
      session_notes: encryptField('Worked on stacking rings.'),
      patient_first_name_idx: hmacIndex('Luz'),
      patient_last_name_idx: hmacIndex('Quintero'),
      billing_status: 'pending',
    };
    const result = decryptAssessmentRow(row);
    expect(result.patient_first_name).toBe('Luz');
    expect(result.patient_last_name).toBe('Quintero');
    expect(result.patient_dob).toBe('2024-03-05');
    expect(result.session_notes).toBe('Worked on stacking rings.');
    expect(result.billing_status).toBe('pending');
    expect(result).not.toHaveProperty('patient_first_name_idx');
    expect(result).not.toHaveProperty('patient_last_name_idx');
  });

  it('returns null unchanged, not an error', () => {
    expect(decryptAssessmentRow(null)).toBeNull();
  });
});
