const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'add_mfa_reset_requests.sql'), 'utf8');

describe('add_mfa_reset_requests.sql', () => {
  test('creates mfa_reset_requests idempotently with the expected columns', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS mfa_reset_requests/);
    expect(sql).toMatch(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(sql).toMatch(/practitioner_id integer NOT NULL REFERENCES practitioners\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/token_hash text NOT NULL UNIQUE/);
    expect(sql).toMatch(/expires_at timestamptz NOT NULL/);
    expect(sql).toMatch(/used_at timestamptz/);
    expect(sql).toMatch(/created_at timestamptz NOT NULL DEFAULT now\(\)/);
  });

  test('adds practitioners.password_changed_at idempotently (nullable)', () => {
    expect(sql).toMatch(/ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;/);
  });

  test('indexes (practitioner_id, created_at) idempotently', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS \w+\s+ON mfa_reset_requests \(practitioner_id, created_at\)/);
  });
});
