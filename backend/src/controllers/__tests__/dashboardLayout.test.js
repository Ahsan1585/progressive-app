jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../../config/db');
const { getDashboardLayout, saveDashboardLayout, DASHBOARD_SECTION_KEYS } = require('../dashboardController');

afterEach(() => jest.resetAllMocks());

describe('DASHBOARD_SECTION_KEYS', () => {
  test('is the fixed 5-key set the frontend and validation both rely on', () => {
    expect(DASHBOARD_SECTION_KEYS).toEqual([
      'pipeline_and_queue', 'services', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory',
    ]);
  });
});

describe('getDashboardLayout', () => {
  test('returns the saved order when one exists', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [{ section_order: ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'] }] });

    await getDashboardLayout(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      sectionOrder: ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'],
    });
  });

  test('returns null sectionOrder when the viewer has never customized', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getDashboardLayout(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, sectionOrder: null });
  });
});

describe('saveDashboardLayout', () => {
  test('upserts a valid permutation of DASHBOARD_SECTION_KEYS', async () => {
    const order = ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'];
    const req = { practitioner: { practitionerId: 7 }, body: { sectionOrder: order } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    pool.query.mockResolvedValueOnce({ rows: [] });

    await saveDashboardLayout(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (practitioner_id)'),
      [7, JSON.stringify(order)]
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('400s on a payload missing a required key', async () => {
    const req = { practitioner: { practitionerId: 7 }, body: { sectionOrder: ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status'] } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s on a payload with a duplicate key', async () => {
    const req = { practitioner: { practitionerId: 7 }, body: { sectionOrder: ['services', 'services', 'accuracy_table', 'eims_status', 'returned_logs_and_trajectory'] } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400s on a payload with an unknown key', async () => {
    const req = { practitioner: { practitionerId: 7 }, body: { sectionOrder: ['services', 'pipeline_and_queue', 'accuracy_table', 'eims_status', 'not_a_real_section'] } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await saveDashboardLayout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
