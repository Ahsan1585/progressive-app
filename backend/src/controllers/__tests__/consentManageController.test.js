// Parent self-service for a signed consent: view, download a copy, withdraw.
// Reached from the link emailed after signing; the child's date of birth is
// required on every action.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn().mockResolvedValue('Acme EI') }));
jest.mock('../../utils/consentNotify', () => ({ notifyConsentStaff: jest.fn() }));
jest.mock('../consentReportController', () => ({
  buildConsentCopyPdf: jest.fn(),
  loadStaffNames: jest.fn(),
}));

const crypto = require('crypto');
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { notifyConsentStaff } = require('../../utils/consentNotify');
const { buildConsentCopyPdf, loadStaffNames } = require('../consentReportController');
const ctrl = require('../consentManageController');

afterEach(() => jest.resetAllMocks());

const RAW = 'c'.repeat(64);
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const future = (ms = 1e10) => new Date(Date.now() + ms).toISOString();
const past = () => new Date(Date.now() - 1e6).toISOString();

const requestRow = (o = {}) => ({
  id: 'req1', patient_id: 42, consent_id: 77, requested_by: 7, manage_token_hash: sha(RAW),
  manage_failed_attempts: 0, manage_locked_at: null, patient_dob: '2024-03-05',
  patient_first_name: 'Timmy', patient_last_name: 'Tester', ...o,
});
const consentRow = (o = {}) => ({
  id: 77, patient_id: 42, recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org', purpose: 'Billing',
  record_types: ['sevf_forms'], expires_at: future(), revoked_at: null, granted_at: '2026-10-01T14:05:00Z',
  granted_by: 7, source: 'electronic', ...o,
});

const mockRes = () => {
  const res = { headers: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn((k, v) => { if (typeof k === 'object') Object.assign(res.headers, k); else res.headers[k] = v; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  return res;
};
const pubReq = (body = {}, token = RAW) => ({ params: { companySlug: 'acme', token }, body, headers: {}, ip: '9.9.9.9' });
const html = (res) => String(res.send.mock.calls[0][0]);

const CLAIM = /SET manage_failed_attempts = manage_failed_attempts \+ 1/;
const RESET = /SET manage_failed_attempts = 0/;

function primeDb({ request = requestRow(), consent = consentRow(), claim = { rows: [{ manage_failed_attempts: 1, manage_locked_at: null }] }, extra = [] } = {}) {
  const handlers = [
    [/FROM records_consent_requests r/, { rows: request ? [request] : [] }],
    [CLAIM, claim],
    [RESET, { rows: [] }],
    [/FROM records_consents WHERE id/, { rows: consent ? [consent] : [] }],
    ...extra,
  ];
  pool.query.mockImplementation(async (sql, params) => {
    for (const [re, v] of handlers) if (re.test(sql)) return typeof v === 'function' ? v(sql, params) : v;
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('landing', () => {
  test('asks only for the date of birth: no consent or child detail, no writes', async () => {
    primeDb();
    const res = mockRes();
    await ctrl.getManageLanding(pubReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const page = html(res);
    expect(page).toMatch(/type="date"/);
    expect(page).not.toMatch(/ABC Billing|billing@abc|Timmy|Tester/);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(pool.query.mock.calls.every(([sql]) => !/^\s*UPDATE/.test(sql))).toBe(true);
  });

  test.each([
    ['unknown link', null, 404],
    ['locked link', requestRow({ manage_locked_at: past() }), 423],
  ])('%s', async (_n, request, status) => {
    primeDb({ request });
    const res = mockRes();
    await ctrl.getManageLanding(pubReq(), res);
    expect(res.status).toHaveBeenCalledWith(status);
  });

  test('a malformed token is a 404 before any query', async () => {
    const res = mockRes();
    await ctrl.getManageLanding(pubReq({}, 'nope'), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('view', () => {
  test('correct DOB shows the consent with withdraw and copy actions', async () => {
    primeDb();
    const res = mockRes();
    await ctrl.viewConsent(pubReq({ dob: '2024-03-05' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const page = html(res);
    expect(page).toMatch(/ABC Billing/);
    expect(page).toMatch(/Timmy Tester/);
    expect(page).toMatch(/Withdraw my consent/);
    expect(page).toMatch(/Download a copy/);
  });

  test('wrong DOB: 403, shows nothing about the consent', async () => {
    primeDb();
    const res = mockRes();
    await ctrl.viewConsent(pubReq({ dob: '2020-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(html(res)).not.toMatch(/ABC Billing/);
  });

  test('the attempt is claimed before comparing; the 5th wrong try locks', async () => {
    primeDb({ claim: { rows: [{ manage_failed_attempts: 5, manage_locked_at: new Date().toISOString() }] } });
    const res = mockRes();
    await ctrl.viewConsent(pubReq({ dob: '2020-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(pool.query.mock.calls.some(([sql]) => CLAIM.test(sql))).toBe(true);
  });

  test('already locked (the claim finds no row): 423 even for the right DOB', async () => {
    primeDb({ claim: { rows: [] } });
    const res = mockRes();
    await ctrl.viewConsent(pubReq({ dob: '2024-03-05' }), res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(html(res)).not.toMatch(/ABC Billing/);
  });

  test('non-string DOB is just a failed attempt', async () => {
    primeDb();
    const res = mockRes();
    await ctrl.viewConsent(pubReq({ dob: { $ne: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a withdrawn consent is shown as withdrawn with no withdraw button', async () => {
    primeDb({ consent: consentRow({ revoked_at: past() }) });
    const res = mockRes();
    await ctrl.viewConsent(pubReq({ dob: '2024-03-05' }), res);
    const page = html(res);
    expect(page).toMatch(/withdrawn/i);
    expect(page).not.toMatch(/Withdraw my consent/);
  });
});

describe('withdraw', () => {
  const withdrawExtra = (rows = [{ id: 77 }]) => [
    [/UPDATE records_consents\s+SET revoked_at = now\(\), revoked_via = 'parent'/, { rows }],
    [/UPDATE records_releases SET revoked_at/, { rows: [] }],
  ];

  test('revokes the consent as parent, kills live release links, audits, tells staff', async () => {
    primeDb({ extra: withdrawExtra() });
    const res = mockRes();
    await ctrl.withdrawConsent(pubReq({ dob: '2024-03-05' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(html(res)).toMatch(/withdrawn/i);
    const sqls = pool.query.mock.calls.map(([s]) => s);
    expect(sqls.some((s) => /records_releases SET revoked_at/.test(s))).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'records_consent_revoked_by_parent', actorRole: 'parent', resourceType: 'patient', resourceId: 42,
    }));
    expect(notifyConsentStaff).toHaveBeenCalledWith('withdrawn', 7);
  });

  test('wrong DOB withdraws nothing', async () => {
    primeDb({ extra: withdrawExtra() });
    const res = mockRes();
    await ctrl.withdrawConsent(pubReq({ dob: '2020-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query.mock.calls.some(([s]) => /SET revoked_at/.test(s))).toBe(false);
  });

  test('already withdrawn: no second audit or notice', async () => {
    primeDb({ extra: withdrawExtra([]) });
    const res = mockRes();
    await ctrl.withdrawConsent(pubReq({ dob: '2024-03-05' }), res);
    expect(logAudit).not.toHaveBeenCalled();
    expect(notifyConsentStaff).not.toHaveBeenCalled();
  });
});

describe('copy', () => {
  test('correct DOB streams the consent copy PDF, no-store', async () => {
    primeDb();
    loadStaffNames.mockResolvedValue(() => 'Sam Staff');
    buildConsentCopyPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const res = mockRes();
    await ctrl.downloadCopy(pubReq({ dob: '2024-03-05' }), res);
    expect(buildConsentCopyPdf).toHaveBeenCalledWith(expect.objectContaining({ childName: 'Timmy Tester' }));
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
  });

  test('wrong DOB serves nothing', async () => {
    primeDb();
    const res = mockRes();
    await ctrl.downloadCopy(pubReq({ dob: '2020-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(buildConsentCopyPdf).not.toHaveBeenCalled();
  });
});
