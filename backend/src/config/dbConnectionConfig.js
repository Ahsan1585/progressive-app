// Shared connection-config builder for every pool this app creates (the
// per-tenant pools, the platform pool, and the elevated provisioning pool)
// so the INSTANCE_UNIX_SOCKET-vs-DATABASE_URL branching logic lives in
// exactly one place instead of being copy-pasted per pool.
function buildConnectionConfig(databaseName, credentialOverride) {
  if (process.env.INSTANCE_UNIX_SOCKET) {
    return {
      host: process.env.INSTANCE_UNIX_SOCKET,
      user: credentialOverride?.user || process.env.DB_USER,
      password: credentialOverride?.password || process.env.DB_PASSWORD,
      database: databaseName,
    };
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL (or INSTANCE_UNIX_SOCKET + DB_USER/DB_PASSWORD/DB_NAME) in .env file');
  }

  // Local/dev TCP fallback — swap the path (database name) and optionally
  // the credentials on the configured DATABASE_URL, keeping everything else
  // (host/port/query params) as-is.
  const url = new URL(process.env.DATABASE_URL);
  if (credentialOverride?.user) url.username = credentialOverride.user;
  if (credentialOverride?.password) url.password = credentialOverride.password;
  url.pathname = `/${databaseName}`;
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
}

module.exports = { buildConnectionConfig };
