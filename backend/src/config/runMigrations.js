const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

// Every file listed here must be purely additive/idempotent (ADD COLUMN IF
// NOT EXISTS, CREATE TABLE IF NOT EXISTS, etc.) — this runs on every boot,
// not just once, so a migration that isn't safe to re-run doesn't belong
// here. Lets a migration ship with a deploy instead of requiring a separate
// manual `psql` step against production.
const MIGRATIONS = ['add_subscription_billing.sql', 'add_dropdown_options.sql'];

async function runMigrations() {
  for (const file of MIGRATIONS) {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations', file), 'utf8');
    await pool.query(sql);
    console.log(`Migration applied: ${file}`);
  }
}

module.exports = { runMigrations };
