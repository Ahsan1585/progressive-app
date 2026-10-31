// getReturnedLogs: ?practitionerId= scopes the returned/declined list, and
// each row gains an hours field (total_time/60) alongside its existing
// amount, plus a list-level totalHours.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/fieldEncryption', () => ({ decryptField: (v) => v }));

const { pool } = require('../../config/db');
const { getReturnedLogs } = require('../dashboardController');

beforeEach(() => pool.query.mockReset());

describe('getReturnedLogs practitioner filter + hours', () => {
  test('the list query binds practitionerId', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/billing_status IN \('rejected', 'declined'\)/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getReturnedLogs({ query: { month: '2026-10', practitionerId: '4' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const [call] = pool.query.mock.calls.filter(([sql]) => /billing_status IN \('rejected', 'declined'\)/.test(sql));
    expect(call[0]).toMatch(/a\.practitioner_id = \$3/);
    expect(call[1]).toContain(4);
  });

  test('each row reports hours, and the list reports totalHours', async () => {
    const rows = [
      { id: 1, billing_status: 'rejected', service_date: '2026-10-01', rejection_note: null, rejected_at: '2026-10-02', rejection_count: 1,
        patient_first_name: 'Harper', patient_last_name: 'Keller', practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy',
        total_time: 90, pay_rate: '40' },
      { id: 2, billing_status: 'declined', service_date: '2026-10-05', rejection_note: null, rejected_at: '2026-10-06', rejection_count: 1,
        patient_first_name: 'Daniel', patient_last_name: 'Esposito', practitioner_first_name: 'Monica', practitioner_last_name: 'Whitaker',
        total_time: 30, pay_rate: '40' },
    ];
    pool.query.mockImplementation(async (sql) => {
      if (/billing_status IN \('rejected', 'declined'\)/.test(sql)) return { rows };
      return { rows: [] };
    });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getReturnedLogs({ query: {} }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.logs[0].hours).toBe(1.5);
    expect(body.logs[1].hours).toBe(0.5);
    expect(body.totalHours).toBe(2);
  });
});
