// POST /api/dev/reset-to-realistic-agency: replaces the tenant's agency data with
// the realistic dataset. Destructive, so it demands a typed confirmation.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../config/storage', () => ({
  BILLING_INVOICES_BUCKET: 'inv', NJEIS_FORMS_BUCKET: 'forms',
  deleteAllTenantFiles: jest.fn().mockResolvedValue(),
  listFilesDetailed: jest.fn(), removeFiles: jest.fn(),
}));
jest.mock('../../testdata/loadAgency', () => ({
  replaceWithRealisticAgency: jest.fn(),
  SEED_PASSWORD: 'TestData@2026',
}));

const { logAudit } = require('../../utils/auditLog');
const { deleteAllTenantFiles } = require('../../config/storage');
const { replaceWithRealisticAgency } = require('../../testdata/loadAgency');
const { resetToRealisticAgency, CONFIRM_PHRASE } = require('../testDataController');

beforeEach(() => {
  replaceWithRealisticAgency.mockReset();
  deleteAllTenantFiles.mockClear();
  logAudit.mockClear();
  deleteAllTenantFiles.mockResolvedValue();
});

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });
const mkReq = (body) => ({ body, practitioner: { practitionerId: 1, role: 'ceo' } });
const SUMMARY = { wiped: { practitionersRemoved: 300 }, practitioners: 13, patients: 128, assignments: 225, sessions: 5783, stats: {} };

test('refuses without the typed confirmation, and touches nothing', async () => {
  for (const body of [undefined, {}, { confirm: 'yes' }, { confirm: CONFIRM_PHRASE.toLowerCase() }]) {
    const res = mkRes();
    await resetToRealisticAgency(mkReq(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
  }
  expect(replaceWithRealisticAgency).not.toHaveBeenCalled();
  expect(deleteAllTenantFiles).not.toHaveBeenCalled();
});

test('with the confirmation it replaces the data, then clears stored billing files, and audits it', async () => {
  replaceWithRealisticAgency.mockResolvedValue(SUMMARY);
  const res = mkRes();
  await resetToRealisticAgency(mkReq({ confirm: CONFIRM_PHRASE, seed: 7, today: '2026-10-22' }), res);
  expect(replaceWithRealisticAgency).toHaveBeenCalledWith(expect.anything(), { seed: 7, today: '2026-10-22' });
  // files are removed only AFTER the database commit succeeded
  expect(deleteAllTenantFiles).toHaveBeenCalledTimes(2);
  const out = res.json.mock.calls[0][0];
  expect(out).toMatchObject({ success: true, practitioners: 13, patients: 128, sessions: 5783, filesDeleted: true });
  expect(out.credentials.password).toBe('TestData@2026');
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'reset_to_realistic_agency' }));
});

test('a failure in the load is a 500 and storage is NOT cleared (the database rolled back)', async () => {
  replaceWithRealisticAgency.mockRejectedValue(new Error('boom'));
  const res = mkRes();
  await resetToRealisticAgency(mkReq({ confirm: CONFIRM_PHRASE }), res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(deleteAllTenantFiles).not.toHaveBeenCalled();
});

test('a storage cleanup failure after a successful load is reported, not fatal', async () => {
  replaceWithRealisticAgency.mockResolvedValue(SUMMARY);
  deleteAllTenantFiles.mockRejectedValue(new Error('gcs'));
  const res = mkRes();
  await resetToRealisticAgency(mkReq({ confirm: CONFIRM_PHRASE }), res);
  expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, filesDeleted: false });
});
