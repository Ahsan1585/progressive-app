const { pool } = require('../config/db');

const OFFICE_ROLES = ['ceo', 'staff_director', 'billing', 'account_specialist'];

// One thread per practitioner (messages.practitioner_id is always the thread
// owner, regardless of which side sent a given row). Office roles can open
// any practitioner's thread; a practitioner can only ever see their own.
const resolveThreadPractitionerId = (req) => {
  if (req.practitioner.role === 'practitioner') {
    return req.practitioner.practitionerId;
  }
  const id = parseInt(req.params.practitionerId, 10);
  return Number.isNaN(id) ? null : id;
};

const getThreads = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id AS practitioner_id,
        p.first_name,
        p.last_name,
        last_msg.body AS last_message,
        last_msg.created_at AS last_message_at,
        last_msg.sender_role AS last_message_sender_role,
        COALESCE(unread.count, 0) AS unread_count
      FROM practitioners p
      LEFT JOIN LATERAL (
        SELECT body, created_at, sender_role
        FROM messages m
        WHERE m.practitioner_id = p.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) last_msg ON true
      LEFT JOIN (
        SELECT practitioner_id, COUNT(*) AS count
        FROM messages
        WHERE sender_role = 'practitioner' AND office_read_at IS NULL
        GROUP BY practitioner_id
      ) unread ON unread.practitioner_id = p.id
      WHERE p.role = 'practitioner' AND p.is_active = true
      ORDER BY last_msg.created_at DESC NULLS LAST, p.first_name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('getThreads error:', err);
    res.status(500).json({ error: 'Failed to load message threads.' });
  }
};

const getThread = async (req, res) => {
  const practitionerId = resolveThreadPractitionerId(req);
  if (!practitionerId) return res.status(400).json({ error: 'Invalid practitioner id.' });

  const isOffice = OFFICE_ROLES.includes(req.practitioner.role);
  if (!isOffice && practitionerId !== req.practitioner.practitionerId) {
    return res.status(403).json({ error: 'Not authorized for this thread.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, practitioner_id, sender_id, sender_role, body, created_at
       FROM messages WHERE practitioner_id = $1 ORDER BY created_at ASC`,
      [practitionerId]
    );

    if (isOffice) {
      await pool.query(
        `UPDATE messages SET office_read_at = now()
         WHERE practitioner_id = $1 AND sender_role = 'practitioner' AND office_read_at IS NULL`,
        [practitionerId]
      );
    } else {
      await pool.query(
        `UPDATE messages SET practitioner_read_at = now()
         WHERE practitioner_id = $1 AND sender_role != 'practitioner' AND practitioner_read_at IS NULL`,
        [practitionerId]
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error('getThread error:', err);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
};

const postMessage = async (req, res) => {
  const practitionerId = resolveThreadPractitionerId(req);
  if (!practitionerId) return res.status(400).json({ error: 'Invalid practitioner id.' });

  const isOffice = OFFICE_ROLES.includes(req.practitioner.role);
  if (!isOffice && practitionerId !== req.practitioner.practitionerId) {
    return res.status(403).json({ error: 'Not authorized for this thread.' });
  }

  const body = (req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body is required.' });

  try {
    const result = await pool.query(
      `INSERT INTO messages (practitioner_id, sender_id, sender_role, body)
       VALUES ($1, $2, $3, $4) RETURNING id, practitioner_id, sender_id, sender_role, body, created_at`,
      [practitionerId, req.practitioner.practitionerId, req.practitioner.role, body]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('postMessage error:', err);
    res.status(500).json({ error: 'Failed to send message.' });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    if (req.practitioner.role === 'practitioner') {
      const result = await pool.query(
        `SELECT COUNT(*) FROM messages
         WHERE practitioner_id = $1 AND sender_role != 'practitioner' AND practitioner_read_at IS NULL`,
        [req.practitioner.practitionerId]
      );
      return res.json({ unreadCount: parseInt(result.rows[0].count, 10) });
    }

    const result = await pool.query(
      `SELECT COUNT(*) FROM messages WHERE sender_role = 'practitioner' AND office_read_at IS NULL`
    );
    res.json({ unreadCount: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    res.status(500).json({ error: 'Failed to load unread count.' });
  }
};

module.exports = { getThreads, getThread, postMessage, getUnreadCount };
