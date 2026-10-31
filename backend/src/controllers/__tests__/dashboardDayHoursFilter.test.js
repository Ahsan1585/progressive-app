// getDayOverview: ?practitionerId= scopes todayRows and exceptionCountRows
// (the two bare-count queries, no practitioner_id previously), plus
// flaggedCount/exceptionCount gain an hours companion.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/fieldEncryption', () => ({ decryptField: (v) => v }));

const { pool } = require('../../config/db');
const { getDayOverview } = require('../dashboardController');

beforeEach(() => pool.query.mockReset());

function baseMock() {
  return async (sql) => {
    if (/completed_at::date = CURRENT_DATE/.test(sql)) return { rows: [{ count: 0, practitioners: 0 }] };
    if (/ORDER BY COALESCE\(a\.held_at, a\.rejected_at\) ASC/.test(sql)) return { rows: [] };
    if (/billing_status = ANY\(\$1::text\[\]\)/.test(sql)) return { rows: [{ count: 0, hours: '0' }] };
    if (/is_platform_support = false/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
}

describe('getDayOverview practitioner filter + hours', () => {
  test('todayRows and exceptionCountRows both bind practitionerId', async () => {
    pool.query.mockImplementation(baseMock());
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getDayOverview({ query: { month: '2026-09', practitionerId: '3' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);

    const todayCall = pool.query.mock.calls.find(([sql]) => /completed_at::date = CURRENT_DATE/.test(sql));
    expect(todayCall[0]).toMatch(/practitioner_id = \$1/);
    expect(todayCall[1]).toContain(3);

    const exceptionCountCall = pool.query.mock.calls.find(([sql]) => /billing_status = ANY\(\$1::text\[\]\)/.test(sql));
    expect(exceptionCountCall[0]).toMatch(/practitioner_id = \$4/);
    expect(exceptionCountCall[1]).toContain(3);
  });

  test('flaggedCount reports flaggedHours alongside it', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/completed_at::date = CURRENT_DATE/.test(sql)) return { rows: [{ count: 0, practitioners: 0 }] };
      if (/ORDER BY COALESCE\(a\.held_at, a\.rejected_at\) ASC/.test(sql)) return { rows: [] };
      if (/billing_status = ANY\(\$1::text\[\]\)/.test(sql)) return { rows: [{ count: 2, hours: '2.5' }] };
      if (/is_platform_support = false/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getDayOverview({ query: { month: '2026-09' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.flaggedCount).toBe(2);
    expect(body.flaggedHours).toBe(2.5);
  });
});
