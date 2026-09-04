const { platformPool } = require('../config/platformDb');
const { getTenantPool } = require('../config/tenantPoolRegistry');

// Resolves a company slug to its tenant database name (registry lookup),
// then hands back a pool bound to that tenant's DB — the same per-tenant
// pool the app uses per-request, just addressed explicitly here rather
// than via the AsyncLocalStorage context (platform-admin has no tenant
// request context). Returns null if the slug doesn't exist.
async function tenantPoolForSlug(slug) {
  const { rows } = await platformPool.query('SELECT tenant_db_name FROM companies WHERE slug = $1', [slug]);
  if (!rows[0]) return null;
  return getTenantPool(rows[0].tenant_db_name);
}

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

// Per-company subscription pricing — what that tenant is charged per active
// practitioner and per office-staff seat beyond the included allotment.
// Lives in the tenant's own company_settings (row id = 1); this endpoint is
// just the cross-DB read for the platform-admin editor. Closed
// subscription_invoices snapshot these values at close time, so an edit
// only affects the current and future periods, never billed history.
const getCompanyPricing = async (req, res) => {
  try {
    const tenantPool = await tenantPoolForSlug(req.params.slug);
    if (!tenantPool) return res.status(404).json({ error: 'Company not found' });
    const { rows } = await tenantPool.query(
      `SELECT subscription_price_per_practitioner, subscription_included_staff_seats,
              subscription_extra_staff_seat_price
       FROM company_settings WHERE id = 1`
    );
    const row = rows[0] || {};
    res.json({
      success: true,
      pricing: {
        pricePerPractitioner: Number(row.subscription_price_per_practitioner ?? 18),
        includedStaffSeats: Number(row.subscription_included_staff_seats ?? 5),
        extraStaffSeatPrice: Number(row.subscription_extra_staff_seat_price ?? 5),
      },
    });
  } catch (error) {
    console.error('Error reading company pricing:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const setCompanyPricing = async (req, res) => {
  const pricePerPractitioner = Number(req.body.pricePerPractitioner);
  const includedStaffSeats = Number(req.body.includedStaffSeats);
  const extraStaffSeatPrice = Number(req.body.extraStaffSeatPrice);

  const validMoney = (n) => Number.isFinite(n) && n >= 0 && n <= 100000;
  if (!validMoney(pricePerPractitioner) || !validMoney(extraStaffSeatPrice)) {
    return res.status(400).json({ error: 'Prices must be numbers between 0 and 100000.' });
  }
  if (!Number.isInteger(includedStaffSeats) || includedStaffSeats < 0 || includedStaffSeats > 1000) {
    return res.status(400).json({ error: 'Included staff seats must be a whole number between 0 and 1000.' });
  }

  try {
    const tenantPool = await tenantPoolForSlug(req.params.slug);
    if (!tenantPool) return res.status(404).json({ error: 'Company not found' });
    const { rows } = await tenantPool.query(
      `UPDATE company_settings
       SET subscription_price_per_practitioner = $1,
           subscription_included_staff_seats = $2,
           subscription_extra_staff_seat_price = $3,
           updated_at = now()
       WHERE id = 1
       RETURNING subscription_price_per_practitioner, subscription_included_staff_seats,
                 subscription_extra_staff_seat_price`,
      [pricePerPractitioner.toFixed(2), includedStaffSeats, extraStaffSeatPrice.toFixed(2)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'This company has no settings row yet.' });
    res.json({
      success: true,
      pricing: {
        pricePerPractitioner: Number(rows[0].subscription_price_per_practitioner),
        includedStaffSeats: Number(rows[0].subscription_included_staff_seats),
        extraStaffSeatPrice: Number(rows[0].subscription_extra_staff_seat_price),
      },
    });
  } catch (error) {
    console.error('Error setting company pricing:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { listCompanies, listPromoCodes, createPromoCode, deactivatePromoCode, setTrialEndDate, getCompanyPricing, setCompanyPricing };
