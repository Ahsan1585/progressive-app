// Public demo booking: a prospect picks a free 30-minute slot, the slot is
// stored once (the database refuses a second booking of the same slot), and the
// confirmation emails never decide whether the booking exists.
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../utils/emailClient', () => ({
  sendDemoBookingEmails: jest.fn().mockResolvedValue(),
  sendDemoBookingCancelledEmails: jest.fn().mockResolvedValue(),
}));

const { platformPool } = require('../../config/platformDb');
const email = require('../../utils/emailClient');
const ctrl = require('../demoBookingController');

const NOW = new Date('2026-10-21T15:00:00Z');
const SLOT = '2026-10-22T13:00:00.000Z'; // Thu 9:00 New York

const mkRes = () => {
  const res = { statusCode: 200 };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
};
const body = (over = {}) => ({
  fullName: 'Dana Ruiz', workEmail: 'dana@brightsteps.org', agencyName: 'Bright Steps EI',
  practitionerCount: '12', slotStart: SLOT, source: 'hero', ...over,
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  platformPool.query.mockReset();
  ctrl.__resetTableReady();
  email.sendDemoBookingEmails.mockReset().mockResolvedValue();
  email.sendDemoBookingCancelledEmails.mockReset().mockResolvedValue();
});
afterEach(() => jest.useRealTimers());

// the first query is always the one-time CREATE TABLE IF NOT EXISTS
const queriesAfterSetup = () => platformPool.query.mock.calls.slice(1);

describe('getSlots', () => {
  test('lists free slots and leaves out booked ones', async () => {
    platformPool.query
      .mockResolvedValueOnce({}) // ensure table
      .mockResolvedValueOnce({ rows: [{ slot_start: new Date(SLOT) }] });
    const res = mkRes();
    await ctrl.getSlots({ query: {} }, res);
    expect(res.body.slots.length).toBeGreaterThan(100);
    expect(res.body.slots).not.toContain(SLOT);
    expect(res.body.timezone).toBe('America/New_York');
  });
});

describe('createBooking', () => {
  test('stores the booking and sends the emails', async () => {
    platformPool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 7, slot_start: new Date(SLOT), slot_end: new Date('2026-10-22T13:30:00Z'), cancel_token: 'tok' }] });
    const res = mkRes();
    await ctrl.createBooking({ body: body() }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.booking.slotStart).toBe(SLOT);
    const [sql, params] = queriesAfterSetup()[0];
    expect(sql).toMatch(/INSERT INTO demo_bookings/);
    expect(params).toEqual(expect.arrayContaining([SLOT, 'Dana Ruiz', 'dana@brightsteps.org', 'Bright Steps EI', 12, 'hero']));
    expect(email.sendDemoBookingEmails).toHaveBeenCalledTimes(1);
  });

  test('a slot someone else just took is a 409, not a second booking', async () => {
    const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
    platformPool.query.mockResolvedValueOnce({}).mockRejectedValueOnce(dup);
    const res = mkRes();
    await ctrl.createBooking({ body: body() }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/just taken/i);
    expect(email.sendDemoBookingEmails).not.toHaveBeenCalled();
  });

  test('a time outside the bookable hours is a 400 and nothing is stored', async () => {
    platformPool.query.mockResolvedValue({});
    const res = mkRes();
    await ctrl.createBooking({ body: body({ slotStart: '2026-10-22T21:00:00.000Z' }) }, res); // 17:00 NY
    expect(res.statusCode).toBe(400);
    expect(queriesAfterSetup().some(([sql]) => /INSERT/.test(sql))).toBe(false);
  });

  test('missing name, email or agency is a 400', async () => {
    platformPool.query.mockResolvedValue({});
    for (const missing of ['fullName', 'workEmail', 'agencyName']) {
      const res = mkRes();
      await ctrl.createBooking({ body: body({ [missing]: '' }) }, res);
      expect(res.statusCode).toBe(400);
    }
    const bad = mkRes();
    await ctrl.createBooking({ body: body({ workEmail: 'not-an-email' }) }, bad);
    expect(bad.statusCode).toBe(400);
  });

  test('the booking survives an email failure', async () => {
    platformPool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 8, slot_start: new Date(SLOT), slot_end: new Date('2026-10-22T13:30:00Z'), cancel_token: 't' }] });
    email.sendDemoBookingEmails.mockRejectedValueOnce(new Error('resend down'));
    const res = mkRes();
    await ctrl.createBooking({ body: body() }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.booking.id).toBe(8);
  });
});

describe('cancelBooking', () => {
  test('cancelling with the emailed token frees the slot', async () => {
    platformPool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 7, slot_start: new Date(SLOT), full_name: 'Dana Ruiz', work_email: 'dana@brightsteps.org', agency_name: 'Bright Steps EI' }] });
    const res = mkRes();
    await ctrl.cancelBooking({ body: { token: 'a'.repeat(64) } }, res);
    expect(res.body.success).toBe(true);
    const [sql, params] = queriesAfterSetup()[0];
    expect(sql).toMatch(/SET status = 'cancelled'/);
    expect(sql).toMatch(/status = 'booked'/);
    expect(params).toEqual(['a'.repeat(64)]);
    expect(email.sendDemoBookingCancelledEmails).toHaveBeenCalledTimes(1);
  });

  test('an unknown or already-cancelled token is a 404', async () => {
    platformPool.query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [] });
    const res = mkRes();
    await ctrl.cancelBooking({ body: { token: 'b'.repeat(64) } }, res);
    expect(res.statusCode).toBe(404);
  });

  test('a malformed token is a 400 and never reaches the database', async () => {
    const res = mkRes();
    await ctrl.cancelBooking({ body: { token: "x' OR 1=1" } }, res);
    expect(res.statusCode).toBe(400);
    expect(platformPool.query).not.toHaveBeenCalled();
  });
});
