const { getFlatSubscriptionSettings } = require('../subscriptionBilling');

jest.mock('../../config/db', () => ({
  pool: { query: jest.fn() },
}));
const { pool } = require('../../config/db');

describe('getFlatSubscriptionSettings', () => {
  afterEach(() => jest.clearAllMocks());

  it('falls back to 19.99 when subscription_flat_price is NULL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ subscription_flat_price: null, stripe_customer_id: null, stripe_default_payment_method_id: null, stripe_default_pm_type: null, stripe_default_pm_brand: null, stripe_default_pm_last4: null, stripe_default_pm_exp: null }] });
    const settings = await getFlatSubscriptionSettings();
    expect(settings.flatPrice).toBe(19.99);
  });

  it('uses the stored price when set', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ subscription_flat_price: '24.99', stripe_customer_id: null, stripe_default_payment_method_id: null, stripe_default_pm_type: null, stripe_default_pm_brand: null, stripe_default_pm_last4: null, stripe_default_pm_exp: null }] });
    const settings = await getFlatSubscriptionSettings();
    expect(settings.flatPrice).toBe(24.99);
  });
});
