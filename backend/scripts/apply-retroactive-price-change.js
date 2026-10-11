// One-time script: applies update_independent_flat_price_1999.sql to every
// existing independent practitioner's own tenant database. Run once per
// environment (staging, then production) after Task 1's other changes are
// deployed. Usage: node backend/scripts/apply-retroactive-price-change.js
const fs = require('fs');
const path = require('path');
const { platformPool } = require('../src/config/platformDb');
const { runWithTenant } = require('../src/config/tenantContext');
const { pool } = require('../src/config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../db/migrations/update_independent_flat_price_1999.sql'),
    'utf8'
  );
  const { rows: companies } = await platformPool.query(
    `SELECT slug, tenant_db_name FROM companies WHERE account_type = 'independent'`
  );
  console.log(`Found ${companies.length} independent practitioner tenant(s).`);
  let updated = 0;
  for (const company of companies) {
    try {
      await runWithTenant(company.tenant_db_name, async () => {
        const result = await pool.query(sql);
        if (result.rowCount > 0) {
          updated += 1;
          console.log(`  ${company.slug}: updated to $19.99`);
        } else {
          console.log(`  ${company.slug}: no change (already non-$30, or company_settings missing)`);
        }
      });
    } catch (err) {
      console.error(`  ${company.slug}: FAILED — ${err.message}`);
    }
  }
  console.log(`Done. ${updated}/${companies.length} tenants updated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
