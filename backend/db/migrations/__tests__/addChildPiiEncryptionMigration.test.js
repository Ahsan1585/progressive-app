const fs = require('fs');
const path = require('path');

const MIGRATION_PATH = path.join(__dirname, '..', 'add_child_pii_encryption.sql');

describe('add_child_pii_encryption migration', () => {
  it('adds the four blind-index columns and widens dob to text', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toMatch(/ALTER TABLE patients[\s\S]*ADD COLUMN.*first_name_idx/i);
    expect(sql).toMatch(/ALTER TABLE patients[\s\S]*ADD COLUMN.*last_name_idx/i);
    expect(sql).toMatch(/ALTER TABLE assessments[\s\S]*ADD COLUMN.*patient_first_name_idx/i);
    expect(sql).toMatch(/ALTER TABLE assessments[\s\S]*ADD COLUMN.*patient_last_name_idx/i);
    expect(sql).toMatch(/ALTER TABLE patients[\s\S]*ALTER COLUMN dob TYPE text/i);
    expect(sql).toMatch(/ALTER TABLE assessments[\s\S]*ALTER COLUMN patient_dob TYPE text/i);
    expect(sql).toMatch(/CREATE INDEX.*first_name_idx/i);
    expect(sql).toMatch(/CREATE INDEX.*last_name_idx/i);
  });

  it('is safe to run twice (IF NOT EXISTS / IF EXISTS guards)', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    const alterAddLines = sql.match(/ADD COLUMN[^\n]*/gi) || [];
    for (const line of alterAddLines) {
      expect(line).toMatch(/IF NOT EXISTS/i);
    }
  });
});
