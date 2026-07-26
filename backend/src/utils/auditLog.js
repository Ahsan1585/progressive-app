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

    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, resource_type, resource_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        finalActorId,
        finalActorEmail,
        finalActorRole,
        action,
        resourceType,
        resourceId != null ? String(resourceId) : null,
        details ? JSON.stringify(details) : null,
        ip,
      ]
    );
  } catch (err) {
    console.error('Audit log insert failed:', err.message);
  }
}

module.exports = { logAudit };
