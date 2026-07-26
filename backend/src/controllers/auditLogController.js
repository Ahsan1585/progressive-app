const { pool } = require('../config/db');

// Admin-only view over audit_logs (see backend/db/schema.sql and
// utils/auditLog.js) — filterable by actor, action, resource type, and date
// range, newest first. This is read-only; the table itself is append-only
// from the app's perspective, with no update/delete code path.
const getAuditLogs = async (req, res) => {
  const { actorId, action, resourceType, startDate, endDate, limit } = req.query;

  try {
    const params = [];
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';

    if (actorId) { params.push(actorId); sql += ` AND actor_id = $${params.length}`; }
    if (action) { params.push(action); sql += ` AND action = $${params.length}`; }
    if (resourceType) { params.push(resourceType); sql += ` AND resource_type = $${params.length}`; }
    if (startDate) { params.push(startDate); sql += ` AND created_at >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND created_at <= $${params.length}::date + interval '1 day'`; }

    sql += ' ORDER BY created_at DESC';

    const parsedLimit = Math.min(parseInt(limit, 10) || 200, 1000);
    params.push(parsedLimit);
    sql += ` LIMIT $${params.length}`;

    const { rows } = await pool.query(sql, params);
    res.json({ success: true, logs: rows });
  } catch (error) {
    console.error('getAuditLogs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

module.exports = { getAuditLogs };
