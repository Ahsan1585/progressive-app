const { platformPool } = require('../config/platformDb');

// Platform-level counterpart to auditLog.js's tenant `logAudit` — records
// actions that don't belong to any single tenant's audit trail (or happen
// before a tenant context exists at all): platform-admin logins, company
// creation, and every impersonation session. Writes straight to
// platformPool, no tenant/AsyncLocalStorage context required or wanted.
// Same fire-and-forget contract: never throws, only console.error's on
// failure, so a logging hiccup can never block the real request.
async function logPlatformAudit({
  platformAdminId = null,
  action,
  targetCompanySlug = null,
  details = null,
  ipAddress = null,
}) {
  try {
    await platformPool.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, action, target_company_slug, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        platformAdminId,
        action,
        targetCompanySlug,
        details ? JSON.stringify(details) : null,
        ipAddress,
      ]
    );
  } catch (err) {
    console.error('Platform audit log insert failed:', err.message);
  }
}

module.exports = { logPlatformAudit };
