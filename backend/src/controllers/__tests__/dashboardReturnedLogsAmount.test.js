// The Returned & declined logs panel on the Overview dashboard showed
// each log's status and note but no dollar value, so a CEO scanning the
// list had no way to tell whether the returned logs amounted to real
// money or were trivial. Each log now carries its line total (hours x
// practitioner pay rate, same calc the AP/invoice queries use) so the
// panel can show it alongside the patient/practitioner names.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/fieldEncryption', () => ({ decryptField: (v) => v }));

const { pool } = require('../../config/db');
const { getReturnedLogs } = require('../dashboardController');

beforeEach(() => {
  pool.query.mockReset();
});

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

describe('getReturnedLogs amount', () => {
  test('each returned log reports its dollar value (hours x pay rate)', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/billing_status IN \('rejected', 'declined'\)/.test(sql)) {
        return {
          rows: [{
            id: 1, billing_status: 'rejected', service_date: '2026-10-20',
            rejection_note: 'No EIMS record', rejected_at: '2026-10-28', rejection_count: 2,
            patient_first_name: 'Harper', patient_last_name: 'Keller',
            practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy',
            total_time: 90, pay_rate: '40',
          }],
        };
      }
      if (/FROM assessment_notes/.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const res = mkRes();
    await getReturnedLogs({ query: { month: '2026-10' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const [log] = res.json.mock.calls[0][0].logs;
    // 90 minutes = 1.5 hrs x $40/hr = $60
    expect(log.amount).toBe(60);
  });
});
