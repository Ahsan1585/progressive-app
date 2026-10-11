const { pool } = require('../config/db');
const { platformPool } = require('../config/platformDb');

// The JWT carries `slug` and `tenantDb` (see authController.js's
// jwt.sign call) but not the platform companies.id (a uuid) directly —
// resolved here by slug each call, same cost/pattern as other lookups
// in this codebase that bridge tenant-scoped requests to platform data.
const getReferrals = async (req, res) => {
  try {
    const { rows: companyRows } = await platformPool.query(
      'SELECT id FROM companies WHERE slug = $1', [req.practitioner.slug]
    );
    const companyId = companyRows[0]?.id;
    if (!companyId) return res.json({ success: true, freeMonthsOwed: 0, referrals: [] });

    const [{ rows: redemptions }, { rows: creditRows }] = await Promise.all([
      platformPool.query(
        `SELECT referred_display_name, referrer_rewarded_at
         FROM referral_redemptions WHERE referrer_company_id = $1 ORDER BY created_at DESC`,
        [companyId]
      ),
      pool.query('SELECT free_months_owed FROM company_settings WHERE id = 1'),
    ]);

    res.json({
      success: true,
      freeMonthsOwed: Number(creditRows[0]?.free_months_owed || 0),
      referrals: redemptions.map((r) => ({
        referredDisplayName: r.referred_display_name,
        status: r.referrer_rewarded_at ? 'rewarded' : 'invited',
        rewardedAt: r.referrer_rewarded_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching referrals:', error);
    res.status(500).json({ error: 'Failed to load referrals' });
  }
};

module.exports = { getReferrals };
