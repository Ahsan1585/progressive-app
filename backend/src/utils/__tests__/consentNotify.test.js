// Who hears about consent activity. The requester always does, worded for where
// they can actually look; when the requester is a practitioner (mobile app
// only, cannot send records) the office admins are told as well, since they are
// the ones who act on it.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../emailClient', () => ({ sendConsentStaffNoticeEmail: jest.fn() }));

const { pool } = require('../../config/db');
const { sendConsentStaffNoticeEmail } = require('../emailClient');
const { notifyConsentStaff } = require('../consentNotify');

afterEach(() => jest.resetAllMocks());

function primeDb({ requester, admins = [] }) {
  pool.query.mockImplementation(async (sql) => {
    if (/role = 'ceo'/.test(sql)) return { rows: admins.map((email) => ({ email })) };
    if (/WHERE id = \$1/.test(sql)) return { rows: requester ? [requester] : [] };
    throw new Error(`unexpected query: ${sql}`);
  });
}

test('office requester: one email, office wording, no extra admin copy', async () => {
  primeDb({ requester: { email: 'staff@x.org', role: 'staff' }, admins: ['boss@x.org'] });
  await notifyConsentStaff('signed', 7);
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledTimes(1);
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('staff@x.org', { kind: 'signed', audience: 'office' });
});

test('ceo requester is office too, and is not emailed twice as an admin', async () => {
  primeDb({ requester: { email: 'boss@x.org', role: 'ceo' }, admins: ['boss@x.org', 'other@x.org'] });
  await notifyConsentStaff('withdrawn', 1);
  expect(sendConsentStaffNoticeEmail.mock.calls.map((c) => c[0])).toEqual(['boss@x.org']);
});

test('practitioner requester: app wording for them, office wording for the admins', async () => {
  primeDb({ requester: { email: 'prac@x.org', role: 'practitioner' }, admins: ['boss@x.org', 'cfo@x.org'] });
  await notifyConsentStaff('signed', 7);
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('prac@x.org', { kind: 'signed', audience: 'practitioner' });
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('boss@x.org', { kind: 'signed', audience: 'office' });
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('cfo@x.org', { kind: 'signed', audience: 'office' });
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledTimes(3);
});

test('a requester who is gone or inactive: the admins are told instead', async () => {
  primeDb({ requester: null, admins: ['boss@x.org'] });
  await notifyConsentStaff('signed', 7);
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('boss@x.org', { kind: 'signed', audience: 'office' });
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledTimes(1);
});

test('independent practitioners are never emailed (out of scope for now)', async () => {
  primeDb({ requester: { email: 'indie@x.org', role: 'independent_practitioner' }, admins: ['boss@x.org'] });
  await notifyConsentStaff('signed', 7);
  expect(sendConsentStaffNoticeEmail).not.toHaveBeenCalled();
});

test('one failed email does not stop the others, and nothing throws', async () => {
  primeDb({ requester: { email: 'prac@x.org', role: 'practitioner' }, admins: ['boss@x.org'] });
  sendConsentStaffNoticeEmail.mockImplementation(async (to) => { if (to === 'prac@x.org') throw new Error('down'); });
  await expect(notifyConsentStaff('signed', 7)).resolves.toBeUndefined();
  expect(sendConsentStaffNoticeEmail).toHaveBeenCalledWith('boss@x.org', { kind: 'signed', audience: 'office' });
});

test('a database error never throws out of the notifier', async () => {
  pool.query.mockRejectedValue(new Error('db'));
  await expect(notifyConsentStaff('signed', 7)).resolves.toBeUndefined();
  expect(sendConsentStaffNoticeEmail).not.toHaveBeenCalled();
});
