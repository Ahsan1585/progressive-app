// backend/src/controllers/roleController.js
const { pool } = require('../config/db');
const { PERMISSION_KEYS } = require('../constants/permissions');

async function listRoles(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.is_system, COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id
       ORDER BY r.is_system DESC, r.name ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

function validatePermissionKeys(keys) {
  if (!Array.isArray(keys)) return false;
  return keys.every((k) => PERMISSION_KEYS.includes(k));
}

async function createRole(req, res, next) {
  const { name, permissions } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Role name is required.' });
  }
  if (!validatePermissionKeys(permissions || [])) {
    return res.status(400).json({ error: 'One or more permission keys are invalid.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO roles (name) VALUES ($1) RETURNING id, name, is_system', [name.trim()]);
    const role = rows[0];
    for (const key of permissions || []) {
      await client.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [role.id, key]);
    }
    await client.query('COMMIT');
    res.status(201).json({ ...role, permissions: permissions || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A role with that name already exists.' });
    }
    next(err);
  } finally {
    client.release();
  }
}

async function updateRole(req, res, next) {
  const { id } = req.params;
  const { name, permissions } = req.body;
  const { rows: existingRows } = await pool.query('SELECT is_system FROM roles WHERE id = $1', [id]);
  if (!existingRows[0]) {
    return res.status(404).json({ error: 'Role not found.' });
  }
  if (existingRows[0].is_system) {
    return res.status(400).json({ error: 'The Admin role cannot be edited.' });
  }
  if (permissions !== undefined && !validatePermissionKeys(permissions)) {
    return res.status(400).json({ error: 'One or more permission keys are invalid.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (name) {
      await client.query('UPDATE roles SET name = $1, updated_at = now() WHERE id = $2', [name.trim(), id]);
    }
    if (permissions !== undefined) {
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
      for (const key of permissions) {
        await client.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [id, key]);
      }
    }
    await client.query('COMMIT');
    res.json({ id, name, permissions });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A role with that name already exists.' });
    }
    next(err);
  } finally {
    client.release();
  }
}

async function deleteRole(req, res, next) {
  const { id } = req.params;
  try {
    const { rows: existingRows } = await pool.query('SELECT is_system FROM roles WHERE id = $1', [id]);
    if (!existingRows[0]) {
      return res.status(404).json({ error: 'Role not found.' });
    }
    if (existingRows[0].is_system) {
      return res.status(400).json({ error: 'The Admin role cannot be deleted.' });
    }
    const { rows: inUse } = await pool.query('SELECT COUNT(*)::int AS count FROM practitioners WHERE role_id = $1', [id]);
    if (inUse[0].count > 0) {
      return res.status(409).json({ error: 'Reassign every staff member off this role before deleting it.' });
    }
    await pool.query('DELETE FROM roles WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listRoles, createRole, updateRole, deleteRole };
