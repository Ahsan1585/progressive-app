const { pool } = require('../config/db');

// Independent-practitioner-only (see routes/notificationRoutes.js's guard).
const listNotifications = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, body, created_at, read_at FROM notifications ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ success: true, notifications: rows });
  } catch (error) {
    console.error('Error listing notifications:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
};

module.exports = { listNotifications, markNotificationRead };
