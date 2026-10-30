// Fix for Important finding I7 from the final whole-branch review of
// docs/superpowers/plans/2026-10-30-child-pii-field-encryption.md: dob
// used to be normalized to YYYY-MM-DD by Postgres's `date` column type on
// write. Now that dob is encrypted as `text`, nothing normalizes it —
// several consumers (consent DOB check, EIMS matching, njeisFormFiller's
// split('-')) assume YYYY-MM-DD after decrypting.
const { patientSchema } = require('../patientSchema');

const base = { firstName: 'Luz', lastName: 'Quintero', county: 'Essex', childId: '123456789' };

describe('patientSchema dob validation', () => {
  it('accepts a YYYY-MM-DD date', () => {
    const result = patientSchema.safeParse({ ...base, dob: '2024-03-05' });
    expect(result.success).toBe(true);
  });

  it('rejects a non-ISO date format like MM/DD/YYYY', () => {
    const result = patientSchema.safeParse({ ...base, dob: '03/05/2024' });
    expect(result.success).toBe(false);
  });

  it('rejects an ISO timestamp (not just a date)', () => {
    const result = patientSchema.safeParse({ ...base, dob: '2024-03-05T00:00:00.000Z' });
    expect(result.success).toBe(false);
  });

  it('rejects a genuinely invalid date', () => {
    const result = patientSchema.safeParse({ ...base, dob: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});
