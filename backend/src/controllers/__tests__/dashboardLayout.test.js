jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../../config/db');
const { getDashboardLayout, saveDashboardLayout, DASHBOARD_CARD_KEYS } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('DASHBOARD_CARD_KEYS', () => {
  test('is the fixed 8-key set the frontend and validation both rely on', () => {
    expect(DASHBOARD_CARD_KEYS).toEqual([
      'billing_pipeline', 'action_queue', 'services_breakdown', 'documents_feed',
      'eims_status', 'returned_logs', 'trajectory_chart', 'county_hours',
    ]);
  });
});

const fullCardLayout = () => DASHBOARD_CARD_KEYS.map((key) => ({ key, width: 'full' }));

describe('getDashboardLayout', () => {
  test('returns the saved card layout when one exists', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const saved = [{ key: 'eims_status', width: 'half' }, { key: 'returned_logs', width: 'half' }, ...DASHBOARD_CARD_KEYS.filter((k) => k !== 'eims_status' && k !== 'returned_logs').map((key) => ({ key, width: 'full' }))];
    pool.query.mockResolvedValueOnce({ rows: [{ section_order: saved }] });

    await getDashboardLayout(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, cardLayout: saved });
  });

  test('returns null cardLayout when the viewer has never customized', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getDashboardLayout(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, cardLayout: null });
  });
});

describe('saveDashboardLayout', () => {
  test('upserts a valid full-width-only permutation of DASHBOARD_CARD_KEYS', async () => {
    const cardLayout = fullCardLayout();
    const req = { practitioner: { practitionerId: 7 }, body: { cardLayout } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await saveDashboardLayout(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (practitioner_id)'),
      [7, JSON.stringify(cardLayout)]
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('upserts a valid layout with some cards set to half width', async () => {
    const cardLayout = DASHBOARD_CARD_KEYS.map((key, i) => ({ key, width: i < 2 ? 'half' : 'full' }));
    const req = { practitioner: { practitionerId: 7 }, body: { cardLayout } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await saveDashboardLayout(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('400s (not 500) when req.body itself is undefined, e.g. no body sent at all', async () => {
    const req = { practitioner: { practitionerId: 7 }, body: undefined };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s on a payload missing a required card key', async () => {
    const cardLayout = fullCardLayout().slice(0, -1);
    const req = { practitioner: { practitionerId: 7 }, body: { cardLayout } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s on a payload with a duplicate card key', async () => {
    const cardLayout = fullCardLayout();
    cardLayout[1] = { ...cardLayout[0] };
    const req = { practitioner: { practitionerId: 7 }, body: { cardLayout } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s on a payload with an unknown card key', async () => {
    const cardLayout = fullCardLayout();
    cardLayout[0] = { key: 'not_a_real_card', width: 'full' };
    const req = { practitioner: { practitionerId: 7 }, body: { cardLayout } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s on a payload with an invalid width value', async () => {
    const cardLayout = fullCardLayout();
    cardLayout[0] = { key: cardLayout[0].key, width: 'huge' };
    const req = { practitioner: { practitionerId: 7 }, body: { cardLayout } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s when cardLayout entries are missing the width field', async () => {
    const cardLayout = DASHBOARD_CARD_KEYS.map((key) => ({ key }));
    const req = { practitioner: { practitionerId: 7 }, body: { cardLayout } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
