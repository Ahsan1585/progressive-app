const { requestIndependentSignup } = require('../independentSignupController');

jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
const { platformPool } = require('../../config/platformDb');
jest.mock('../../utils/emailClient', () => ({
  sendIndependentSignupConfirmationEmail: jest.fn(),
  sendIndependentWelcomeEmail: jest.fn(),
  sendReferralFirstMonthFreeEmail: jest.fn(),
}));

function mockReqRes(body) {
  const req = { body };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { req, res };
}

describe('requestIndependentSignup referral handling', () => {
  afterEach(() => jest.clearAllMocks());

  it('stores a valid referral code on the pending_signups row', async () => {
    const validBody = {
      slug: 'jsmith', firstName: 'Jamie', lastName: 'Smith', email: 'jamie@example.com',
      password: 'Abcd1234!', disciplines: ['OT'], payRate: 50,
      addressLine1: '1 Main St', addressCity: 'Trenton', addressState: 'NJ', addressZip: '08608',
      address: '1 Main St, Trenton, NJ 08608',
      baaAccepted: true, baaAcceptedByName: 'Jamie Smith', baaAcceptedByEmail: 'jamie@example.com',
      referredByCode: 'referrer-slug',
    };
    // slug availability check
    platformPool.query.mockResolvedValueOnce({ rows: [] });
    // email-exists check
    platformPool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT INTO pending_signups
    platformPool.query.mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes(validBody);
    await requestIndependentSignup(req, res);

    const insertCall = platformPool.query.mock.calls.find((call) => call[0].includes('INSERT INTO pending_signups'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('referrer-slug');
    expect(res.status).toHaveBeenCalledWith(202);
  });
});

const { confirmIndependentSignup } = require('../independentSignupController');
jest.mock('../../config/provisioningDb', () => ({ getProvisioningPool: jest.fn() }));
jest.mock('../../config/tenantPoolRegistry', () => ({ evictTenantPool: jest.fn() }));
jest.mock('../../utils/tenantProvisioning', () => ({
  provisionTenantDatabase: jest.fn().mockResolvedValue({
    tenantPool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
    adminRoleId: 1,
  }),
}));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/notifications', () => ({ writeNotification: jest.fn() }));

function basePending(overrides = {}) {
  return {
    slug: 'new-practitioner', display_name: 'New Person', email: 'new@example.com',
    confirm_token_hash: 'hash', confirm_token_expires: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    account_type: 'independent', ceo_first_name: 'New', ceo_last_name: 'Person',
    ceo_email: 'new@example.com', ceo_password_hash: 'hashed', pay_rate: 50,
    address: '1 St', disciplines: ['OT'], address_line1: '1 St', address_city: 'Trenton',
    address_state: 'NJ', address_zip: '08608', baa_accepted_at: new Date().toISOString(),
    baa_accepted_by_name: 'New Person', baa_accepted_by_email: 'new@example.com',
    custom_dropdown_options: null, removed_default_options: null,
    referred_by_code: null,
    ...overrides,
  };
}

describe('confirmIndependentSignup referral resolution', () => {
  afterEach(() => jest.clearAllMocks());

  it('sets referred_by_company_id and pre-loads free_months_owed=1 when referred_by_code resolves', async () => {
    const pending = basePending({ referred_by_code: 'referrer-slug' });
    platformPool.query
      .mockResolvedValueOnce({ rows: [pending] })       // lookup by token
      .mockResolvedValueOnce({ rows: [] })               // existing company by slug check
      .mockResolvedValueOnce({ rows: [{ id: 'referrer-uuid' }] }) // resolve referred_by_code -> companies.id
      .mockResolvedValueOnce({ rows: [] })               // INSERT INTO companies
      .mockResolvedValueOnce({ rows: [{ id: 'new-company-uuid' }] }) // SELECT companies WHERE slug = pending.slug (to get new company id)
      .mockResolvedValueOnce({ rows: [] })               // INSERT INTO referral_redemptions
      .mockResolvedValueOnce({ rows: [{ email: 'referrer@example.com', display_name: 'Referrer Co' }] }) // SELECT referrer email/display_name for post-signup email
      .mockResolvedValueOnce({ rows: [] });               // DELETE FROM pending_signups

    const { provisionTenantDatabase } = require('../../utils/tenantProvisioning');
    const tenantQueryMock = jest.fn().mockResolvedValue({ rows: [] });
    provisionTenantDatabase.mockResolvedValue({ tenantPool: { query: tenantQueryMock }, adminRoleId: 1 });

    const { req, res } = mockReqRes({});
    req.params = { token: 'raw-token' };
    await confirmIndependentSignup(req, res);

    const freeMonthsCall = tenantQueryMock.mock.calls.find((call) => call[0].includes('free_months_owed'));
    expect(freeMonthsCall).toBeDefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('ignores a referral code that matches the signer\'s own slug (self-referral)', async () => {
    const pending = basePending({ slug: 'jsmith', referred_by_code: 'jsmith' });
    platformPool.query
      .mockResolvedValueOnce({ rows: [pending] }) // lookup by token
      .mockResolvedValueOnce({ rows: [] })         // existing company by slug check
      .mockResolvedValueOnce({ rows: [] })         // INSERT INTO companies
      .mockResolvedValueOnce({ rows: [] });         // DELETE FROM pending_signups

    const { provisionTenantDatabase } = require('../../utils/tenantProvisioning');
    const tenantQueryMock = jest.fn().mockResolvedValue({ rows: [] });
    provisionTenantDatabase.mockResolvedValue({ tenantPool: { query: tenantQueryMock }, adminRoleId: 1 });

    const { req, res } = mockReqRes({});
    req.params = { token: 'raw-token' };
    await confirmIndependentSignup(req, res);

    const referrerLookup = platformPool.query.mock.calls.find((call) =>
      call[0].includes("account_type = 'independent'") && call[0].includes('status !=')
    );
    expect(referrerLookup).toBeUndefined();
    const freeMonthsCall = tenantQueryMock.mock.calls.find((call) => call[0].includes('free_months_owed'));
    expect(freeMonthsCall).toBeUndefined();
  });

  it('signs up successfully even when referred_by_code does not resolve to any real company', async () => {
    const pending = basePending({ referred_by_code: 'nonexistent-slug-xyz' });
    platformPool.query
      .mockResolvedValueOnce({ rows: [pending] }) // lookup by token
      .mockResolvedValueOnce({ rows: [] })         // existing company by slug check
      .mockResolvedValueOnce({ rows: [] })         // SELECT companies WHERE slug = referred_by_code -> no match
      .mockResolvedValueOnce({ rows: [] })         // INSERT INTO companies
      .mockResolvedValueOnce({ rows: [] });         // DELETE FROM pending_signups

    const { provisionTenantDatabase } = require('../../utils/tenantProvisioning');
    const tenantQueryMock = jest.fn().mockResolvedValue({ rows: [] });
    provisionTenantDatabase.mockResolvedValue({ tenantPool: { query: tenantQueryMock }, adminRoleId: 1 });

    const { req, res } = mockReqRes({});
    req.params = { token: 'raw-token' };
    await confirmIndependentSignup(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const freeMonthsCall = tenantQueryMock.mock.calls.find((call) => call[0].includes('free_months_owed'));
    expect(freeMonthsCall).toBeUndefined();
  });

  it('sends the welcome email with the login code to every confirmed signup, referred or not', async () => {
    const pending = basePending({ slug: 'jsmith', display_name: 'Jamie Smith', ceo_email: 'jamie@example.com' });
    platformPool.query
      .mockResolvedValueOnce({ rows: [pending] }) // lookup by token
      .mockResolvedValueOnce({ rows: [] })         // existing company by slug check
      .mockResolvedValueOnce({ rows: [] })         // INSERT INTO companies
      .mockResolvedValueOnce({ rows: [] });         // DELETE FROM pending_signups

    const { provisionTenantDatabase } = require('../../utils/tenantProvisioning');
    const tenantQueryMock = jest.fn().mockResolvedValue({ rows: [] });
    provisionTenantDatabase.mockResolvedValue({ tenantPool: { query: tenantQueryMock }, adminRoleId: 1 });

    const { sendIndependentWelcomeEmail } = require('../../utils/emailClient');

    const { req, res } = mockReqRes({});
    req.params = { token: 'raw-token' };
    await confirmIndependentSignup(req, res);

    expect(sendIndependentWelcomeEmail).toHaveBeenCalledWith(
      'jamie@example.com',
      expect.objectContaining({ practitionerName: 'Jamie Smith', loginCode: 'jsmith' })
    );
  });
});
