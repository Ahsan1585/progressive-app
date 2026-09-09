const { pool } = require('../config/db');

// Per-office-staffer chat-dock state — which practitioner conversations they
// have open, in what order, and which are minimized. Persisted so the dock
// survives navigation and logout→re-login. Keyed by the STAFF member's own
// practitioner id (they are a row in `practitioners` too). Tenant-scoped by
// the usual db.js proxy — this only ever touches the caller's own tenant DB.

const MAX_OPEN_THREADS = 20;

const getDock = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT open_threads FROM message_dock_state WHERE practitioner_id = $1',
      [req.practitioner.practitionerId]
    );
    res.json({ openThreads: rows[0]?.open_threads ?? [] });
  } catch (err) {
    console.error('getDock error:', err);
    res.status(500).json({ error: 'Failed to load dock state.' });
  }
};

const putDock = async (req, res) => {
  const input = req.body?.openThreads;
  if (!Array.isArray(input)) {
    return res.status(400).json({ error: 'openThreads must be an array.' });
  }
  if (input.length > MAX_OPEN_THREADS) {
    return res.status(400).json({ error: `Too many open threads (max ${MAX_OPEN_THREADS}).` });
  }
  const cleaned = [];
  for (const t of input) {
    const practitionerId = Number(t?.practitionerId);
    const order = Number(t?.order);
    if (!Number.isInteger(practitionerId) || practitionerId <= 0) {
      return res.status(400).json({ error: 'Each thread needs a positive integer practitionerId.' });
    }
    cleaned.push({
      practitionerId,
      minimized: !!t?.minimized,
      order: Number.isInteger(order) ? order : cleaned.length,
    });
  }

  try {
    await pool.query(
      `INSERT INTO message_dock_state (practitioner_id, open_threads, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (practitioner_id)
       DO UPDATE SET open_threads = EXCLUDED.open_threads, updated_at = now()`,
      [req.practitioner.practitionerId, JSON.stringify(cleaned)]
    );
    res.json({ success: true, openThreads: cleaned });
  } catch (err) {
    console.error('putDock error:', err);
    res.status(500).json({ error: 'Failed to save dock state.' });
  }
};

module.exports = { getDock, putDock };
