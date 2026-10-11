const { getReferrals } = require('../referralController');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { platformPool } = require('../../config/platformDb');

describe('getReferrals', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns free months owed and the referral list with status', async () => {
    const req = { practitioner: { slug: 'my-slug' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    platformPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'my-company-uuid' }] }) // resolve slug -> companies.id
      .mockResolvedValueOnce({ rows: [
        { referred_display_name: 'Jamie Smith', referrer_rewarded_at: '2026-10-05T00:00:00Z' },
        { referred_display_name: 'Alex Lee', referrer_rewarded_at: null },
      ] }); // referral_redemptions list
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 1 }] });

    await getReferrals(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      referralCode: 'my-slug',
      freeMonthsOwed: 1,
      referrals: [
        { referredDisplayName: 'Jamie Smith', status: 'rewarded', rewardedAt: '2026-10-05T00:00:00Z' },
        { referredDisplayName: 'Alex Lee', status: 'invited', rewardedAt: null },
      ],
    });
  });
});
