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

  it('writes a bill-due-soon notification when a real (non-waived) invoice is created and a payment method is on file', async () => {
    const flatSettingsRow = { subscription_flat_price: '19.99', stripe_customer_id: 'cus_1', stripe_default_payment_method_id: 'pm_1' };
    // computeFlatRatePeriodSummary -> getFlatSubscriptionSettings's own query
    pool.query.mockResolvedValueOnce({ rows: [flatSettingsRow] });
    // no existing invoice for this period
    pool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT ... RETURNING * (pending invoice row)
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3, total_amount: '19.99', status: 'pending' }] });
    // SELECT free_months_owed -> 0, no credit to spend
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 0 }] });
    // getFlatSubscriptionSettings() called again directly, now checked BEFORE the notification decision
    pool.query.mockResolvedValueOnce({ rows: [flatSettingsRow] });
    // the real Stripe charge that then proceeds, since a payment method is on file
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3, total_amount: '19.99', status: 'paid' }] });

    const stripe = { paymentIntents: { create: jest.fn().mockResolvedValue({ status: 'succeeded', id: 'pi_1' }) } };
    getStripeClient.mockReturnValue(stripe);

    await closePeriodInvoice('2026-10-01', '2026-10-31', 'independent');

    expect(writeNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'bill_due_soon' }));
  });

  it('does NOT write a bill-due-soon notification when no payment method is on file yet (card collection deferred)', async () => {
    const flatSettingsRow = { subscription_flat_price: '19.99', stripe_customer_id: null, stripe_default_payment_method_id: null };
    pool.query.mockResolvedValueOnce({ rows: [flatSettingsRow] });
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3, total_amount: '19.99', status: 'pending' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 0 }] });
    pool.query.mockResolvedValueOnce({ rows: [flatSettingsRow] });

    await closePeriodInvoice('2026-10-01', '2026-10-31', 'independent');

    expect(writeNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'bill_due_soon' }));
  });

  it('writes a payment-failed notification when the Stripe charge attempt errors', async () => {
    const flatSettingsRow = { subscription_flat_price: '19.99', stripe_customer_id: 'cus_1', stripe_default_payment_method_id: 'pm_1' };
    pool.query.mockResolvedValueOnce({ rows: [flatSettingsRow] });
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 4, total_amount: '19.99', status: 'pending' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ free_months_owed: 0 }] });
    pool.query.mockResolvedValueOnce({ rows: [flatSettingsRow] });
    // UPDATE subscription_invoices SET status = 'failed' ... RETURNING *
    pool.query.mockResolvedValueOnce({ rows: [{ id: 4, total_amount: '19.99', status: 'failed' }] });

    const stripe = { paymentIntents: { create: jest.fn().mockRejectedValue(new Error('card declined')) } };
    getStripeClient.mockReturnValue(stripe);

    await closePeriodInvoice('2026-10-01', '2026-10-31', 'independent');

    expect(writeNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'payment_failed' }));
  });
});

describe('stripeWebhook referrer reward', () => {
  afterEach(() => jest.clearAllMocks());

  it('grants the referrer a free month on the referred practitioner\'s 2nd real paid invoice', async () => {
    const stripe = {
      webhooks: { constructEvent: jest.fn(() => ({
        type: 'payment_intent.succeeded',
        data: { object: { customer: 'cus_referred', id: 'pi_123', last_payment_error: null } },
      })) },
    };
    getStripeClient.mockReturnValue(stripe);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    platformPool.query
      .mockResolvedValueOnce({ rows: [{ tenant_db_name: 'tenant_referred' }] }) // resolve tenant by stripe customer
      .mockResolvedValueOnce({ rows: [{ id: 'referred-uuid' }] }) // resolve tenant_db_name -> companies.id (referred)
      .mockResolvedValueOnce({ rows: [{ referrer_company_id: 'referrer-uuid', referrer_rewarded_at: null }] }) // referral_redemptions lookup
      .mockResolvedValueOnce({ rows: [{ tenant_db_name: 'tenant_referrer', email: 'referrer@example.com', display_name: 'Referrer Co' }] }) // resolve referrer's tenant_db_name/email/display_name
      .mockResolvedValueOnce({ rows: [] }) // UPDATE referral_redemptions
      .mockResolvedValueOnce({ rows: [{ display_name: 'Referred Co' }] }); // SELECT referred company's display_name for the email/notification copy

    pool.query
      .mockResolvedValueOnce({ rows: [] }) // UPDATE subscription_invoices status
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // COUNT paid non-waived invoices for this tenant -> this IS the 2nd
      .mockResolvedValueOnce({ rows: [] }); // UPDATE company_settings free_months_owed +1 (runs inside runWithTenant for referrer)

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
    await stripeWebhook(req, res);

    expect(writeNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'referral_reward_earned' }));
    expect(sendReferralRewardEarnedEmail).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('does not double-grant a reward if the webhook fires twice for the same event', async () => {
    const stripe = { webhooks: { constructEvent: jest.fn(() => ({
      type: 'payment_intent.succeeded',
      data: { object: { customer: 'cus_referred', id: 'pi_123', last_payment_error: null } },
    })) } };
    getStripeClient.mockReturnValue(stripe);

    platformPool.query
      .mockResolvedValueOnce({ rows: [{ tenant_db_name: 'tenant_referred' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'referred-uuid' }] })
      .mockResolvedValueOnce({ rows: [{ referrer_company_id: 'referrer-uuid', referrer_rewarded_at: '2026-10-01T00:00:00Z' }] }); // already rewarded

    pool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE subscription_invoices status

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
    await stripeWebhook(req, res);

    expect(writeNotification).not.toHaveBeenCalled();
    expect(sendReferralRewardEarnedEmail).not.toHaveBeenCalled();
  });

  it('rewards the referrer even if the paid-invoice count jumps past exactly 2 (e.g. a batch backfill)', async () => {
    const stripe = { webhooks: { constructEvent: jest.fn(() => ({
      type: 'payment_intent.succeeded',
      data: { object: { customer: 'cus_referred', id: 'pi_999', last_payment_error: null } },
    })) } };
    getStripeClient.mockReturnValue(stripe);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    platformPool.query
      .mockResolvedValueOnce({ rows: [{ tenant_db_name: 'tenant_referred' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'referred-uuid' }] })
      .mockResolvedValueOnce({ rows: [{ referrer_company_id: 'referrer-uuid', referrer_rewarded_at: null }] })
      .mockResolvedValueOnce({ rows: [{ tenant_db_name: 'tenant_referrer', email: 'referrer@example.com', display_name: 'Referrer Co' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ display_name: 'Referred Co' }] });

    pool.query
      .mockResolvedValueOnce({ rows: [] }) // UPDATE subscription_invoices status
      .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // a batch backfill paid 3 invoices at once -- count skipped past 2
      .mockResolvedValueOnce({ rows: [] });

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
    await stripeWebhook(req, res);

    expect(writeNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'referral_reward_earned' }));
    expect(sendReferralRewardEarnedEmail).toHaveBeenCalled();
  });
});
