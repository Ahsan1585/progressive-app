const { listNotifications, markNotificationRead } = require('../notificationController');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db');

function mockReqRes(params = {}) {
  const req = { params };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { req, res };
}

describe('notificationController', () => {
  afterEach(() => jest.clearAllMocks());

  it('lists notifications newest first', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, type: 'referral_reward_earned', title: 'T', body: 'B', created_at: '2026-10-02', read_at: null }] });
    const { req, res } = mockReqRes();
    await listNotifications(req, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, notifications: expect.any(Array) });
  });

  it('marks a notification read', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const { req, res } = mockReqRes({ id: '5' });
    await markNotificationRead(req, res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
