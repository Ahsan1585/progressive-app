// Expiry reminders for records consents: staff get a neutral heads-up 30 and 7
// days before a consent lapses, once per stage, and the work is only marked
// done for consents whose email actually went out.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../emailClient', () => ({ sendConsentStaffNoticeEmail: jest.fn() }));

const { pool } = require('../../config/db');
const { sendConsentStaffNoticeEmail } = require('../emailClient');
const { sweepConsentExpiry } = require('../consentExpirySweep');

afterEach(() => jest.resetAllMocks());

// stage queries are distinguished by the interval they use.
function primeDb({ due7 = [], due30 = [], admins = [] } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (/UPDATE records_consents/.test(sql)) return { rows: [], rowCount: 1 };
    if (/role = 'ceo'/.test(sql)) return { rows: admins };
    if (/interval '30 days'/.test(sql)) return { rows: due30 }; // checked first: its SQL also mentions 7 days
    if (/interval '7 days'/.test(sql)) return { rows: due7 };
    throw new Error(`unexpected query: ${sql}`);
  });
}
const marks = () => pool.query.mock.calls.filter(([sql]) => /UPDATE records_consents/.test(sql));

test('one email per staff member per stage, however many consents', async () => {
  primeDb({ due30: [{ id: 1, email: 'a@x.org' }, { id: 2, email: 'a@x.org' }, { id: 3, email: 'b@x.org' }] });
  sendConsentStaffNoticeEmail.mockResolvedValue();
  const out = await sweepConsentExpiry();
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledTimes(2);
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('a@x.org', { kind: 'expiring' });
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('b@x.org', { kind: 'expiring' });
  expect(out.notified).toBe(3);
});

test('marks only the consents whose email was sent, so a failure is retried next sweep', async () => {
  primeDb({ due30: [{ id: 1, email: 'a@x.org' }, { id: 3, email: 'b@x.org' }] });
  sendConsentStaffNoticeEmail.mockImplementation(async (to) => { if (to === 'b@x.org') throw new Error('down'); });
  await sweepConsentExpiry();
  const [, params] = marks()[0];
  expect(params[0]).toEqual([1]);
});

test('the 7-day stage marks both stages so nobody gets two emails at once', async () => {
  primeDb({ due7: [{ id: 5, email: 'a@x.org' }] });
  sendConsentStaffNoticeEmail.mockResolvedValue();
  await sweepConsentExpiry();
  const [sql] = marks()[0];
  expect(sql).toMatch(/reminded_7_at = now\(\)/);
  expect(sql).toMatch(/reminded_30_at = COALESCE\(reminded_30_at, now\(\)\)/);
});

test('a consent whose granting staff member has no usable email falls back to the active admins', async () => {
  primeDb({ due30: [{ id: 9, email: null }], admins: [{ email: 'boss@x.org' }] });
  sendConsentStaffNoticeEmail.mockResolvedValue();
  await sweepConsentExpiry();
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('boss@x.org', { kind: 'expiring' });
});

test('nothing due: no emails, no writes', async () => {
  primeDb();
  const out = await sweepConsentExpiry();
  expect(sendConsentStaffNoticeEmail).not.toHaveBeenCalled();
  expect(marks()).toHaveLength(0);
  expect(out.notified).toBe(0);
});

test('only active, unexpired, non-independent consents are selected', async () => {
  primeDb();
  await sweepConsentExpiry();
  const select = pool.query.mock.calls.map(([s]) => s).find((s) => /reminded_30_at IS NULL/.test(s));
  expect(select).toMatch(/revoked_at IS NULL/);
  expect(select).toMatch(/expires_at > now\(\)/);
  expect(select).toMatch(/independent_practitioner/);
});
