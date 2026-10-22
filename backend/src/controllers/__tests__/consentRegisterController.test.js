// Agency-wide register of every consent on file, for the records office.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));

const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { listConsentRegister, deriveStatus } = require('../consentRegisterController');

afterEach(() => jest.resetAllMocks());

const day = 86400000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const row = (o = {}) => ({
  id: 5, patient_id: 10, first_name: 'Timmy', last_name: 'OBrien', child_id: 'NJ-1',
  recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org', purpose: 'Billing',
  record_types: ['sevf_forms'], source: 'electronic', signed_on: null, granted_at: iso(-10 * day),
  expires_at: iso(200 * day), revoked_at: null, revoked_via: null,
  live_releases: 0, total_releases: 0, last_sent_at: null, total_downloads: 0, paper_scan_path: null, ...o,
});

describe('deriveStatus', () => {
  test.each([
    [{ revoked_at: iso(-day) }, 'revoked'],
    [{ expires_at: iso(-day) }, 'expired'],
    [{ expires_at: iso(10 * day) }, 'expiring'],
    [{ expires_at: iso(31 * day) }, 'active'],
    [{ expires_at: null }, 'active'],
    [{ revoked_at: iso(-day), expires_at: iso(-day) }, 'revoked'],
  ])('%j -> %s', (o, expected) => {
    expect(deriveStatus(row(o))).toBe(expected);
  });
});

describe('listConsentRegister', () => {
  const res = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis(), set: jest.fn() });

  test('maps each consent with status, awaiting-send and who revoked it; never exposes the scan path', async () => {
    pool.query.mockResolvedValue({ rows: [
      row({ id: 1 }),
      row({ id: 2, live_releases: 1, total_releases: 1, last_sent_at: iso(-day), total_downloads: 2 }),
      row({ id: 3, revoked_at: iso(-day), revoked_via: 'parent' }),
      row({ id: 4, source: 'paper', paper_scan_path: 'consent-scans/4.pdf' }),
    ] });
    const r = res();
    await listConsentRegister({ practitioner: { practitionerId: 3 } }, r);
    const { consents } = r.json.mock.calls[0][0];
    expect(consents.map((c) => c.status)).toEqual(['active', 'active', 'revoked', 'active']);
    expect(consents[0]).toMatchObject({ patientName: 'Timmy OBrien', childId: 'NJ-1', awaitingSend: true, recipientEmail: 'billing@abc.org' });
    expect(consents[1]).toMatchObject({ awaitingSend: false, downloads: 2 });
    expect(consents[2]).toMatchObject({ revokedBy: 'parent', awaitingSend: false });
    expect(consents[3].hasScan).toBe(true);
    expect(JSON.stringify(consents)).not.toContain('consent-scans');
    expect(r.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'consent_register_view', resourceType: 'consent' }));
  });

  test('500 on a database error', async () => {
    pool.query.mockRejectedValue(new Error('db'));
    const r = res();
    await listConsentRegister({ practitioner: { practitionerId: 3 } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});
