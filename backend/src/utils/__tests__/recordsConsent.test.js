jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');
const { checkConsent } = require('../recordsConsent');

describe('checkConsent', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns ok:true with the consent id when an active matching consent exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });

    const result = await checkConsent(10, 'ABC Billing', ['sevf_forms']);

    expect(result).toEqual({ ok: true, consentId: 42 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('lower(recipient_name) = lower($2)'),
      [10, 'ABC Billing', ['sevf_forms']]
    );
  });

  test('returns ok:false when no matching consent exists at all', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await checkConsent(10, 'ABC Billing', ['sevf_forms']);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('No consent on file');
  });

  test('query excludes revoked and expired consents, and requires every record type covered', async () => {
    // We don't fake the DB's own revocation/expiration logic here — we
    // assert the SQL text includes the WHERE clauses that encode it,
    // since the real enforcement runs inside Postgres (revoked_at IS NULL,
    // expires_at > now(), record_types @> the requested set).
    pool.query.mockResolvedValueOnce({ rows: [] });

    await checkConsent(10, 'ABC Billing', ['sevf_forms', 'invoices']);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at > now()');
    expect(sql).toContain('record_types @>');
    expect(params).toEqual([10, 'ABC Billing', ['sevf_forms', 'invoices']]);
  });

  test('trims the recipient name before matching', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 7 }] });

    await checkConsent(10, '  ABC Billing  ', ['sevf_forms']);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [10, 'ABC Billing', ['sevf_forms']]);
  });

  // Final-review fix (Critical): the gate previously only checked
  // recipient_name (a free-text label), never the actual address a
  // disclosure is sent to — a consent for "ABC Billing" passed for a send
  // to ANY email, since company_affiliation and the practitioner-typed
  // agencyEmail have no required relationship. When a recipientEmail is
  // supplied, the consent must match it too.
  test('when a recipientEmail is supplied, also requires recipient_email to match (case-insensitive)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });

    await checkConsent(10, 'ABC Billing', ['sevf_forms'], 'billing@abc.org');

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('lower(recipient_email) = lower($4)');
    expect(params).toEqual([10, 'ABC Billing', ['sevf_forms'], 'billing@abc.org']);
  });

  test('blocks when recipient_name matches but recipient_email does not', async () => {
    // The real enforcement is in the SQL's WHERE clause (asserted above);
    // here we confirm a non-matching email yields ok:false end-to-end
    // when the DB (correctly) returns no row for the mismatched address.
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await checkConsent(10, 'ABC Billing', ['sevf_forms'], 'not-the-consented-address@other.org');

    expect(result.ok).toBe(false);
  });

  test('omitting recipientEmail does not add an email filter (back-compat for non-email disclosures)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 7 }] });

    await checkConsent(10, 'ABC Billing', ['sevf_forms']);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toContain('recipient_email');
    expect(params).toEqual([10, 'ABC Billing', ['sevf_forms']]);
  });
});
