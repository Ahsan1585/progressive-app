const { Pool, types } = require('pg');
require('dotenv').config();

// pg parses `date` columns into JS Date objects by default. Supabase's
// PostgREST API always serialized `date` columns as plain "YYYY-MM-DD"
// strings, and the app's PDF/report generation code throughout
// (billingController, reportController, patientRoutes, index.js) does
// string ops (.split('-'), string concatenation) directly on patient_dob/
// service_date/etc. expecting that format. Returning the raw text instead
// of a parsed Date restores exact parity without touching every call site.
types.setTypeParser(types.builtins.DATE, (val) => val);

// On Cloud Run, INSTANCE_UNIX_SOCKET points at the Cloud SQL Auth Proxy's
// Unix socket (/cloudsql/<INSTANCE_CONNECTION_NAME>), attached via
// --add-cloudsql-instances. Locally/elsewhere, DATABASE_URL is used instead.
const pool = process.env.INSTANCE_UNIX_SOCKET
  ? new Pool({
      host: process.env.INSTANCE_UNIX_SOCKET,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    })
  : new Pool({
      connectionString: process.env.DATABASE_URL,
      // Local/dev TCP fallback only — the production path is the Cloud SQL Unix
      // socket above, where the Auth Proxy handles encryption and this branch
      // isn't used at all. rejectUnauthorized: false accepts the pooled/managed
      // Postgres provider's cert chain without pinning a CA for local testing.
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
    });

if (!process.env.INSTANCE_UNIX_SOCKET && !process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL (or INSTANCE_UNIX_SOCKET + DB_USER/DB_PASSWORD/DB_NAME) in .env file');
}

module.exports = { pool };
