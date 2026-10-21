const fs = require('fs');
const path = require('path');
const { MIGRATIONS } = require('../index');

describe('add_dashboard_layouts.sql migration registration', () => {
  test('is listed in MIGRATIONS so it runs on every tenant boot and new signup', () => {
    expect(MIGRATIONS).toContain('add_dashboard_layouts.sql');
  });

  test('is idempotent (CREATE TABLE IF NOT EXISTS), matching every other migration in this list', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'add_dashboard_layouts.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS dashboard_layouts/);
  });
});
