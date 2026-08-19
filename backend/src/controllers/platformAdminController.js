const { platformPool } = require('../config/platformDb');

// Deliberately no PHI in this response — only registry metadata (see the
// multi-tenant-foundation plan, section F/G).
const listCompanies = async (req, res) => {
  try {
    const { rows } = await platformPool.query(
      `SELECT slug, display_name, status, trial_ends_at, created_at
       FROM companies ORDER BY created_at DESC`
    );
    res.json({ success: true, companies: rows });
  } catch (error) {
    console.error('Error listing companies:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const listPromoCodes = async (req, res) => {
  try {
    const { rows } = await platformPool.query(
      `SELECT id, code, days_extension, max_redemptions, redemption_count, is_active, expires_at, note, created_at
       FROM promo_codes ORDER BY created_at DESC`
    );
    res.json({ success: true, promoCodes: rows });
  } catch (error) {
    console.error('Error listing promo codes:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const createPromoCode = async (req, res) => {
  const { code, daysExtension, maxRedemptions, expiresAt, note } = req.body;
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  const days = Number(daysExtension);
  if (!normalizedCode) {
    return res.status(400).json({ error: 'code is required' });
  }
  if (!Number.isInteger(days) || days <= 0) {
    return res.status(400).json({ error: 'daysExtension must be a positive integer' });
  }
  try {
    const { rows } = await platformPool.query(
      `INSERT INTO promo_codes (code, days_extension, max_redemptions, expires_at, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, days_extension, max_redemptions, redemption_count, is_active, expires_at, note, created_at`,
      [normalizedCode, days, maxRedemptions || null, expiresAt || null, note || null]
    );
    res.status(201).json({ success: true, promoCode: rows[0] });
  } catch (error) {
    if (error.code === '23505') { // unique_violation on promo_codes_code_key
      return res.status(409).json({ error: 'A promo code with that code already exists.' });
    }
    console.error('Error creating promo code:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const deactivatePromoCode = async (req, res) => {
  try {
    const { rows } = await platformPool.query(
      `UPDATE promo_codes SET is_active = false WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Promo code not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deactivating promo code:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Manual override for a specific tenant's trial_ends_at — the same lever a
// promo code redemption pulls, just picked directly rather than via a code.
// Restricted to companies already on status = 'trial' — this is meant to
// adjust when an existing trial ends, not to silently demote a paying
// ('active'), suspended, or cancelled company back onto a trial clock. A
// company that needs to start a trial from scratch is a different, separate
// action this endpoint deliberately doesn't perform.
const setTrialEndDate = async (req, res) => {
  const { trialEndsAt } = req.body;
  if (!trialEndsAt || Number.isNaN(new Date(trialEndsAt).getTime())) {
    return res.status(400).json({ error: 'A valid trialEndsAt date is required.' });
  }
  try {
    const { rows: existing } = await platformPool.query('SELECT status FROM companies WHERE slug = $1', [req.params.slug]);
    if (!existing[0]) return res.status(404).json({ error: 'Company not found' });
    if (existing[0].status !== 'trial') {
      return res.status(400).json({ error: `Only companies currently on a trial can have their trial end date set (this one is ${existing[0].status}).` });
    }

    const { rows } = await platformPool.query(
      `UPDATE companies SET trial_ends_at = $1, updated_at = now()
       WHERE slug = $2 RETURNING slug, status, trial_ends_at`,
      [trialEndsAt, req.params.slug]
    );
    res.json({ success: true, company: rows[0] });
  } catch (error) {
    console.error('Error setting trial end date:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { listCompanies, listPromoCodes, createPromoCode, deactivatePromoCode, setTrialEndDate };
