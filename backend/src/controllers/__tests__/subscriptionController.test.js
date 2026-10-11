jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantContext', () => ({
  runWithTenant: jest.fn((db, fn) => fn()),
  getCurrentTenantDb: jest.fn(),
}));
jest.mock('../../config/stripe', () => ({
  getStripeClient: jest.fn(() => ({ paymentIntents: { create: jest.fn() }, webhooks: { constructEvent: jest.fn() } })),
  isStripeConfigured: jest.fn(() => true),
  isGooglePayConfigured: jest.fn(() => true),
}));
jest.mock('../../utils/notifications', () => ({ writeNotification: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({
  sendReferralFirstMonthFreeEmail: jest.fn(),
  sendReferralRewardEarnedEmail: jest.fn(),
}));
const { pool } = require('../../config/db');
const { platformPool } = require('../../config/platformDb');
const { getStripeClient } = require('../../config/stripe');
const { writeNotification } = require('../../utils/notifications');
const { sendReferralRewardEarnedEmail } = require('../../utils/emailClient');
const { closePeriodInvoice, stripeWebhook } = require('../subscriptionController');

describe('closePeriodInvoice free-month credit', () => {
  afterEach(() => jest.clearAllMocks());

  it('waives the invoice and skips Stripe when free_months_owed > 0', async () => {
    // computeFlatRatePeriodSummary -> getFlatSubscriptionSettings's own query
    pool.query.mockResolvedValueOnce({ rows: [{ subscription_flat_price: '19.99', stripe_customer_id: null, stripe_default_payment_method_id: null }] });
    // no existing invoice for this period
    pool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT ... RETURNING * (pending invoice row)
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, total_amount: '19.99', status: 'pending' }] });
    // SELECT free_months_owed
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 1 }] });
    // UPDATE subscription_invoices SET status='paid', waived_by_referral=true ... RETURNING *
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, total_amount: '19.99', status: 'paid', waived_by_referral: true }] });
    // UPDATE company_settings SET free_months_owed = free_months_owed - 1
    pool.query.mockResolvedValueOnce({ rows: [] });

    const invoice = await closePeriodInvoice('2026-10-01', '2026-10-31', 'independent');

    expect(invoice.status).toBe('paid');
    expect(invoice.waived_by_referral).toBe(true);
    expect(getStripeClient().paymentIntents.create).not.toHaveBeenCalled();
  });

  it('consumes exactly one credit even when free_months_owed is 2', async () => {
    // computeFlatRatePeriodSummary -> getFlatSubscriptionSettings's own query
    pool.query.mockResolvedValueOnce({ rows: [{ subscription_flat_price: '19.99', stripe_customer_id: null, stripe_default_payment_method_id: null }] });
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, total_amount: '19.99', status: 'pending' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 2 }] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, total_amount: '19.99', status: 'paid', waived_by_referral: true }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    await closePeriodInvoice('2026-10-01', '2026-10-31', 'independent');

    const decrementCall = pool.query.mock.calls.find((call) => call[0].includes('free_months_owed = free_months_owed - 1'));
    expect(decrementCall).toBeDefined();
    expect(decrementCall[0]).not.toContain('- 2');
  });
});
