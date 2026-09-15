const { platformPool } = require('../config/platformDb');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public, unauthenticated — reached from a plain link/form in an outbound
// marketing email (e.g. the trial newsletter's unsubscribe footer), not
// from an app session. There's no mailing-list/campaign system behind
// these sends (they're pasted manually into an email client per
// izaya-consulting's newsletter setup), so this just records a bare email
// address into izaya_platform's own suppression list — nothing to do with
// any tenant's data. Upsert-on-conflict makes a repeat click harmless
// instead of erroring.
const submitUnsubscribe = async (req, res) => {
  try {
    const email = String(req.body?.email || req.query?.email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    await platformPool.query(
      `INSERT INTO marketing_unsubscribes (email, source)
       VALUES ($1, 'newsletter_link')
       ON CONFLICT (lower(email)) DO NOTHING`,
      [email]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('submitUnsubscribe error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Platform-admin only — the read side of the same list, for Izaya staff to
// see who has opted out before a future send.
const listUnsubscribes = async (req, res) => {
  try {
    const { rows } = await platformPool.query(
      `SELECT email, unsubscribed_at, source FROM marketing_unsubscribes ORDER BY unsubscribed_at DESC`
    );
    res.json({ success: true, unsubscribes: rows });
  } catch (err) {
    console.error('listUnsubscribes error:', err);
    res.status(500).json({ error: 'Failed to load unsubscribe list.' });
  }
};

module.exports = { submitUnsubscribe, listUnsubscribes };
