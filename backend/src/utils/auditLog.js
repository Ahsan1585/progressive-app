const { pool } = require('../config/db');

// HIPAA Security Rule audit-controls requirement (45 CFR 164.312(b)) — a
// record of who touched PHI (patient records, the compliance reference doc,
// generated NJEIS/invoice/audit PDFs) and when. Fire-and-forget: a logging
// hiccup must never block or fail the real request, so failures are only
// logged server-side, never surfaced to the caller.
//
// `req` supplies the actor from the verified JWT (req.practitioner, set by
// authMiddleware's `protect`) when available. For pre-auth events (e.g. a
// login attempt, where there's no token yet) pass actorId/actorEmail/actorRole
// explicitly instead.
//
// Izaya Support attribution: when the action is performed during a
// platform-admin impersonation session (req.practitioner.impersonation,
// set at token-mint time — see platformProvisioningController.js), the row
// otherwise records only the hidden support account's own identity
// (actor_email = support+<slug>@izayaedge.com), with no link back to which
// platform admin was actually behind it. Every call site already passes
// `req`, so folding the platform admin's identity into `details` here
// covers all of them for free — deliberately scoped to only these
// already-PHI-adjacent audited actions, not a new blanket "log everything
// support does" mechanism.
const RETRY_DELAY_MS = 250;

async function logAudit({
  req = null,
  actorId = null,
  actorEmail = null,
  actorRole = null,
  action,
  resourceType,
  resourceId = null,
  details = null,
}) {
  try {
    const finalActorId = actorId ?? req?.practitioner?.practitionerId ?? null;
    const finalActorEmail = actorEmail ?? req?.practitioner?.email ?? null;
    const finalActorRole = actorRole ?? req?.practitioner?.role ?? null;
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || null;

    const impersonation = req?.practitioner?.impersonation;
    const finalDetails = impersonation
      ? { ...(details || {}), viaImpersonation: true, platformAdminEmail: impersonation.platformAdminEmail, impersonationStartedAt: impersonation.startedAt }
      : details;

    const params = [
      finalActorId,
      finalActorEmail,
      finalActorRole,
      action,
      resourceType,
      resourceId != null ? String(resourceId) : null,
      finalDetails ? JSON.stringify(finalDetails) : null,
      ip,
    ];
    const sql = `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, resource_type, resource_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
    try {
      await pool.query(sql, params);
    } catch (firstErr) {
      // Retry once after a short delay; if it still fails, emit the full
      // payload as one structured line so Cloud Run logs preserve the record.
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        await pool.query(sql, params);
      } catch (err) {
        console.error('AUDIT_LOG_INSERT_FAILED ' + JSON.stringify({
          timestamp: new Date().toISOString(),
          error: err.message,
          actorId: finalActorId,
          actorEmail: finalActorEmail,
          actorRole: finalActorRole,
          action,
          resourceType,
          resourceId: params[5],
          details: finalDetails,
          ip,
        }));
      }
    }
  } catch (err) {
    console.error('Audit log payload build failed:', err.message);
  }
}

module.exports = { logAudit };
