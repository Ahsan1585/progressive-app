jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn() }));

const http = require('http');
const bcrypt = require('bcryptjs');
const { PDFDocument } = require('pdf-lib');
const { generateSecret, generateTotp } = require('../../utils/totp');
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { getCompanyName } = require('../../utils/companyName');
const {
  exportPatientRecord,
  overrideExportPatientRecord,
  resetOverrideFailures,
  buildDisclosureRows,
  describeAuditRow,
} = require('../patientRecordExportController');

const PASSWORD = 'correct horse battery';
const HASH = bcrypt.hashSync(PASSWORD, 4);
const PATIENT = { id: 10, first_name: 'Timmy', last_name: 'T' };

// Routes each query by its SQL so tests don't depend on call order.
function mockDb({
  patient = PATIENT, coveringConsent = null, passwordRow = { password_hash: HASH }, assessments = [],
  mfaUpdateRows = [{ id: 7 }],
} = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (/FROM patients WHERE id/.test(sql)) return { rows: patient ? [patient] : [] };
    if (/FROM records_consents/.test(sql) && /full_record_export/.test(sql)) return { rows: coveringConsent ? [coveringConsent] : [] };
    if (/FROM records_consents/.test(sql)) return { rows: [] };
    if (/UPDATE practitioners SET mfa_last_used_step/.test(sql)) return { rows: mfaUpdateRows };
    if (/UPDATE practitioners/.test(sql)) return { rows: [] };
    if (/FROM practitioners WHERE id = ANY/.test(sql)) return { rows: [] };
    if (/FROM practitioners WHERE id/.test(sql)) return { rows: passwordRow ? [passwordRow] : [] };
    if (/FROM assessments/.test(sql)) return { rows: assessments };
    return { rows: [] }; // audit_logs
  });
}

// setHeader validates like Node's real one (throws ERR_INVALID_CHAR on e.g. a
// curly apostrophe), so a bad filename fails here the way it does in prod.
const mkRes = () => {
  const res = {
    setHeader: jest.fn((name, value) => http.validateHeaderValue(name, value)),
    send: jest.fn(),
    json: jest.fn(),
  };
  res.status = jest.fn(() => res);
  return res;
};
const futureIso = () => new Date(Date.now() + 1e10).toISOString();
const COVERING = {
  id: 55, patient_id: 10, recipient_name: 'ABC Early Learning', recipient_email: 'x@abc.org', purpose: 'School transition',
  record_types: ['full_record_export'], granted_at: '2026-10-01T14:05:00Z', signed_on: '2026-09-30', expires_at: futureIso(),
  revoked_at: null, source: 'paper', identity_verified_method: 'photo_id', proof_note: 'In chart', paper_attested: true, granted_by: 7,
};
const ASSESSMENT = {
  id: 1, patient_id: 10, practitioner_id: 7, practitioner_first_name: 'Đức', practitioner_last_name: 'Trần', service_date: '2026-09-01',
  start_time: '09:00', end_time: '10:00', total_time: 60, type: 'SI', location: 'Home', billing_status: 'billed', company_affiliation: 'Acme',
};
const getReq = (over = {}) => ({
  params: { id: '10' }, query: {}, headers: {}, isAdmin: false,
  practitioner: { practitionerId: 7, email: 'office@x.com', tenantDb: 't1' }, ...over,
});
const postReq = (body, over = {}) => getReq({ isAdmin: true, body, ...over });

beforeEach(() => {
  getCompanyName.mockResolvedValue('Acme');
  resetOverrideFailures();
});
afterEach(() => {
  jest.resetAllMocks();
  // Spies (bcrypt.compare, Date.now) must never leak into the next test,
  // even when an assertion fails before a test restores them.
  jest.restoreAllMocks();
});

const coverageCall = () => pool.query.mock.calls.find(([sql]) => /FROM records_consents/.test(sql) && /full_record_export/.test(sql));

describe('GET record-export consent gate', () => {
  test("a covering consent returns that consent's disclosure packet, audited to the consent's real recipient", async () => {
    mockDb({ coveringConsent: COVERING, assessments: [ASSESSMENT] });
    const res = mkRes();
    await exportPatientRecord(getReq(), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="consent-report-T-abc-early-learning.pdf"');
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'consent_report_generated', resourceType: 'patient', resourceId: '10',
      details: { consentId: 55, recordTypes: ['full_record_export'], recipient: 'ABC Early Learning', purpose: 'School transition' },
    }));
    // Never claims the parent was the recipient, and never includes the
    // parent-only sections (access history, disclosures, other consents).
    expect(logAudit.mock.calls.some(([e]) => e.action === 'patient_record_export')).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => /audit_logs/.test(sql))).toBe(false);
    expect(pool.query.mock.calls.filter(([sql]) => /records_consents/.test(sql))).toHaveLength(1);
    // Packet = cover + consent copy + session logs + SEVF + billing.
    const doc = await PDFDocument.load(res.send.mock.calls[0][0]);
    expect(doc.getPageCount()).toBe(5);
  });

  test('the coverage query picks the most recently granted covering consent', async () => {
    mockDb({ coveringConsent: COVERING });
    await exportPatientRecord(getReq(), mkRes());
    expect(coverageCall()[0]).toMatch(/ORDER BY granted_at DESC/);
  });

  test('the coverage query requires active, unexpired, full_record_export, scoped to THIS patient', async () => {
    mockDb({ coveringConsent: COVERING });
    await exportPatientRecord(getReq(), mkRes());
    const [sql, params] = coverageCall();
    expect(sql).toMatch(/patient_id = \$1/);
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(sql).toMatch(/expires_at > now\(\)/);
    expect(sql).toMatch(/'full_record_export' = ANY\(record_types\)/);
    expect(params).toEqual(['10']);
  });

  test.each([
    ['admin', true],
    ['non-admin', false],
  ])('no covering consent (none / revoked / expired / other record types / other child) -> 403 CONSENT_REQUIRED for %s', async (_who, isAdmin) => {
    mockDb({ coveringConsent: null });
    const res = mkRes();
    await exportPatientRecord(getReq({ isAdmin }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      code: 'CONSENT_REQUIRED',
      error: 'No active parent consent covers a full record export for this child.',
      canOverride: isAdmin,
      requiresMfaCode: false,
    });
    expect(res.send).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
    // Nothing was generated: no assessment / audit-log reads.
    expect(pool.query.mock.calls.some(([sql]) => /FROM assessments|FROM audit_logs/.test(sql))).toBe(false);
  });

  test('requiresMfaCode is true only for an admin who has MFA enabled', async () => {
    mockDb({ passwordRow: { password_hash: HASH, mfa_enabled: true } });
    const admin = mkRes();
    await exportPatientRecord(getReq({ isAdmin: true }), admin);
    expect(admin.json).toHaveBeenCalledWith(expect.objectContaining({ canOverride: true, requiresMfaCode: true }));
    const call = pool.query.mock.calls.find(([sql]) => /FROM practitioners WHERE id/.test(sql));
    expect(call[1]).toEqual([7]);

    pool.query.mockClear();
    const staff = mkRes();
    await exportPatientRecord(getReq({ isAdmin: false }), staff);
    expect(staff.json).toHaveBeenCalledWith(expect.objectContaining({ canOverride: false, requiresMfaCode: false }));
    expect(pool.query.mock.calls.some(([sql]) => /FROM practitioners/.test(sql))).toBe(false);
  });

  test('canOverride is strictly req.isAdmin === true', async () => {
    mockDb();
    const res = mkRes();
    await exportPatientRecord(getReq({ isAdmin: 'yes' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ canOverride: false }));
  });

  test('a bad patient id -> 404 without touching the DB', async () => {
    for (const id of ['abc', '0', '-1', '99999999999']) {
      const res = mkRes();
      await exportPatientRecord(getReq({ params: { id } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('an unknown child -> 404', async () => {
    mockDb({ patient: null });
    const res = mkRes();
    await exportPatientRecord(getReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('POST record-export/override', () => {
  test('non-admin -> 403, nothing checked', async () => {
    mockDb();
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }, { isAdmin: false }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('impersonation / support session -> 403', async () => {
    mockDb();
    const res = mkRes();
    const req = postReq({ password: PASSWORD, reason: 'audit' });
    req.practitioner.impersonation = { platformAdminEmail: 'support@izaya.com' };
    await overrideExportPatientRecord(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).not.toHaveBeenCalled();
  });

  test.each([[undefined], [''], ['because'], ['AUDIT']])('reason %p -> 400', async (reason) => {
    mockDb();
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).not.toHaveBeenCalled();
  });

  test('bad patient id -> 404', async () => {
    mockDb();
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }, { params: { id: 'x' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test.each([['wrong password', 'nope'], ['missing password', undefined]])('%s -> 400 and audited as failed, password never logged', async (_label, password) => {
    mockDb();
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password, reason: 'legal' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Password is incorrect.' });
    expect(res.send).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledTimes(1);
    const entry = logAudit.mock.calls[0][0];
    expect(entry).toEqual(expect.objectContaining({
      action: 'record_export_override_failed', resourceType: 'patient', resourceId: '10',
      details: { reason: 'legal' },
    }));
    expect(JSON.stringify(entry.details)).not.toMatch(/nope/);
  });

  test("loads the signed-in practitioner's own hash", async () => {
    mockDb();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), mkRes());
    const call = pool.query.mock.calls.find(([sql]) => /FROM practitioners WHERE id/.test(sql));
    expect(call[1]).toEqual([7]);
  });

  test('a missing practitioner row / non-string hash fails safely (400, not 500)', async () => {
    for (const passwordRow of [null, { password_hash: null }]) {
      mockDb({ passwordRow });
      const res = mkRes();
      await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  test('correct password -> same PDF response, audited with the reason; no consent needed', async () => {
    mockDb({ coveringConsent: null });
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'parent_request' }), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringMatching(/^attachment; filename="record-export-T-\d+\.pdf"$/));
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'record_export_override', resourceType: 'patient', resourceId: '10',
      details: expect.objectContaining({ reason: 'parent_request' }),
    }));
    expect(JSON.stringify(logAudit.mock.calls.map(([e]) => e.details))).not.toContain(PASSWORD);
  });

  test.each([
    ['O’Brien', 'OBrien'],
    ['Łukasz', 'Lukasz'],
    ['Say "hi"', 'Sayhi'],
    ['Line\r\nInjected: x', 'LineInjectedx'],
    ['서울', 'child'],
  ])('last name %j -> a header-safe filename (%s)', async (lastName, slug) => {
    mockDb({ patient: { ...PATIENT, last_name: lastName } });
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'parent_request' }), res);
    expect(res.status).not.toHaveBeenCalled();
    const header = res.setHeader.mock.calls.find(([n]) => n === 'Content-Disposition')[1];
    expect(header).toMatch(/^attachment; filename="record-export-[A-Za-z0-9-]+-\d+\.pdf"$/);
    expect(header).toContain(`record-export-${slug}-`);
    expect(res.send).toHaveBeenCalled();
  });

  test('headers are set before the audit row: a header failure leaves no false disclosure entry', async () => {
    mockDb();
    const res = mkRes();
    res.setHeader.mockImplementation(() => { throw new Error('ERR_INVALID_CHAR'); });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'parent_request' }), res);
    errSpy.mockRestore();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logAudit.mock.calls.some(([e]) => e.action === 'record_export_override')).toBe(false);
  });

  test("a full export for 'Łukasz Nguyễn' (with a SEVF) succeeds", async () => {
    mockDb({ patient: { ...PATIENT, first_name: 'Łukasz', last_name: 'Nguyễn', county: 'Łódź', child_id: 'NJ-ł1' }, assessments: [ASSESSMENT] });
    getCompanyName.mockResolvedValue('Ełk Early Intervention');
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'parent_request' }), res);
    const errors = errSpy.mock.calls;
    errSpy.mockRestore();
    expect(errors).toEqual([]); // the SEVF was not silently dropped either
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringMatching(/filename="record-export-Nguyen-\d+\.pdf"$/));
    const doc = await PDFDocument.load(res.send.mock.calls[0][0]);
    // cover, sessions, SEVF, billing, access history, disclosures, consents
    expect(doc.getPageCount()).toBe(7);
  });

  test('unknown child with correct password -> 404', async () => {
    mockDb({ patient: null });
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('5 failures lock the practitioner out (429), even with the right password; other users unaffected', async () => {
    mockDb();
    for (let i = 0; i < 5; i += 1) {
      const res = mkRes();
      await overrideExportPatientRecord(postReq({ password: 'wrong', reason: 'audit' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    const locked = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), locked);
    expect(locked.status).toHaveBeenCalledWith(429);
    expect(locked.json).toHaveBeenCalledWith({ error: 'Too many incorrect passwords. Try again later.' });
    expect(locked.send).not.toHaveBeenCalled();

    // Same practitioner id in a different tenant is a different user.
    const other = mkRes();
    const req = postReq({ password: PASSWORD, reason: 'audit' });
    req.practitioner.tenantDb = 't2';
    await overrideExportPatientRecord(req, other);
    expect(other.send).toHaveBeenCalled();
  });

  test('the lockout expires after 15 minutes', async () => {
    mockDb();
    const now = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    for (let i = 0; i < 5; i += 1) await overrideExportPatientRecord(postReq({ password: 'wrong', reason: 'audit' }), mkRes());
    now.mockReturnValue(t0 + 15 * 60 * 1000 + 1);
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), res);
    expect(res.send).toHaveBeenCalled();
    now.mockRestore();
  });

  test('4 failures then success clears the counter', async () => {
    mockDb();
    for (let i = 0; i < 4; i += 1) await overrideExportPatientRecord(postReq({ password: 'wrong', reason: 'audit' }), mkRes());
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), mkRes());
    for (let i = 0; i < 4; i += 1) await overrideExportPatientRecord(postReq({ password: 'wrong', reason: 'audit' }), mkRes());
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), res);
    expect(res.send).toHaveBeenCalled();
  });
});

describe('override limiter: attempts are reserved before any await', () => {
  test('20 parallel wrong-password calls: at most 5 reach bcrypt.compare, the rest are 429 and audited', async () => {
    mockDb();
    const compare = jest.spyOn(bcrypt, 'compare');
    const results = await Promise.all(Array.from({ length: 20 }, async () => {
      const res = mkRes();
      await overrideExportPatientRecord(postReq({ password: 'wrong', reason: 'audit' }), res);
      return res;
    }));
    expect(compare.mock.calls.length).toBeLessThanOrEqual(5);
    const statuses = results.map((r) => r.status.mock.calls[0][0]);
    expect(statuses.filter((st) => st === 400)).toHaveLength(5);
    expect(statuses.filter((st) => st === 429)).toHaveLength(15);
    const limited = logAudit.mock.calls.filter(([e]) => e.action === 'record_export_override_failed' && e.details.rateLimited === true);
    expect(limited).toHaveLength(15);
    expect(limited[0][0].details).toEqual({ reason: 'audit', rateLimited: true });
    compare.mockRestore();
  });

  test('parallel correct-password calls are not locked out by each other', async () => {
    mockDb();
    const results = await Promise.all(Array.from({ length: 3 }, async () => {
      const res = mkRes();
      await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), res);
      return res;
    }));
    results.forEach((r) => expect(r.send).toHaveBeenCalled());
  });

  test('a 429 counts as an attempt: rejected requests keep extending the lockout', async () => {
    mockDb();
    const now = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    for (let i = 0; i < 5; i += 1) await overrideExportPatientRecord(postReq({ password: 'wrong', reason: 'audit' }), mkRes());
    now.mockReturnValue(t0 + 10 * 60 * 1000);
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), mkRes()); // 429, counted
    now.mockReturnValue(t0 + 15 * 60 * 1000 + 1);
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    now.mockRestore();
  });
});

describe('override MFA step-up (admin with mfa_enabled)', () => {
  const SECRET = generateSecret();
  const mfaRow = (o = {}) => ({ password_hash: HASH, mfa_enabled: true, mfa_secret: SECRET, mfa_last_used_step: null, mfa_locked_until: null, ...o });
  const wrongCode = () => (generateTotp(SECRET) === '000000' ? '111111' : '000000');

  test('the password query also loads the MFA state', async () => {
    mockDb({ passwordRow: mfaRow() });
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit', code: generateTotp(SECRET) }), mkRes());
    const [sql] = pool.query.mock.calls.find(([q]) => /FROM practitioners WHERE id/.test(q));
    expect(sql).toMatch(/password_hash/);
    expect(sql).toMatch(/mfa_enabled/);
    expect(sql).toMatch(/mfa_secret/);
    expect(sql).toMatch(/mfa_last_used_step/);
    expect(sql).toMatch(/mfa_locked_until/);
  });

  test('correct password + current code -> PDF, and the step is consumed atomically (replay guard)', async () => {
    mockDb({ passwordRow: mfaRow() });
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit', code: generateTotp(SECRET) }), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
    const upd = pool.query.mock.calls.find(([q]) => /UPDATE practitioners SET mfa_last_used_step/.test(q));
    expect(upd[0]).toMatch(/mfa_last_used_step IS NULL OR mfa_last_used_step < \$2/);
    expect(upd[1]).toEqual([7, expect.any(Number)]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'record_export_override' }));
  });

  test.each([
    ['missing code', () => undefined],
    ['wrong code', wrongCode],
    ['malformed code', () => 'abc'],
  ])('%s -> 400 "Verification code is incorrect." and audited as a failed override', async (_l, codeFn) => {
    mockDb({ passwordRow: mfaRow() });
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'legal', code: codeFn() }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Verification code is incorrect.' });
    expect(res.send).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'record_export_override_failed', resourceId: '10',
      details: expect.objectContaining({ reason: 'legal' }),
    }));
    expect(logAudit.mock.calls.some(([e]) => e.action === 'record_export_override')).toBe(false);
  });

  test('a wrong code also counts toward the account MFA lockout (same UPDATE as login)', async () => {
    mockDb({ passwordRow: mfaRow() });
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit', code: wrongCode() }), mkRes());
    expect(pool.query.mock.calls.some(([q]) => /mfa_failed_attempts = mfa_failed_attempts \+ 1/.test(q))).toBe(true);
  });

  test('a replayed code (step already used) -> 400', async () => {
    mockDb({ passwordRow: mfaRow(), mfaUpdateRows: [] });
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit', code: generateTotp(SECRET) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Verification code is incorrect.' });
    expect(res.send).not.toHaveBeenCalled();
  });

  test('an account under MFA lockout (mfa_locked_until in the future) -> 429, nothing exported', async () => {
    mockDb({ passwordRow: mfaRow({ mfa_locked_until: futureIso() }) });
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit', code: generateTotp(SECRET) }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'record_export_override_failed' }));
  });

  test('wrong codes count toward the same override limiter', async () => {
    mockDb({ passwordRow: mfaRow() });
    for (let i = 0; i < 5; i += 1) {
      await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit', code: 'abc' }), mkRes());
    }
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit', code: generateTotp(SECRET) }), res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('admins without MFA need no code', async () => {
    mockDb({ passwordRow: { password_hash: HASH, mfa_enabled: false } });
    const res = mkRes();
    await overrideExportPatientRecord(postReq({ password: PASSWORD, reason: 'audit' }), res);
    expect(res.send).toHaveBeenCalled();
  });
});

describe('access history + record of disclosures for override exports', () => {
  test('internal_review / audit overrides stay in the access history only, never the parent-facing disclosures', () => {
    const at = '2026-10-20T15:00:00Z';
    const rows = buildDisclosureRows([
      { action: 'record_export_override', created_at: at, details: { reason: 'internal_review' } },
      { action: 'record_export_override', created_at: at, details: { reason: 'audit' } },
      { action: 'record_export_override', created_at: at, details: { reason: 'parent_request' } },
      { action: 'record_export_override', created_at: at, details: { reason: 'legal' } },
    ]);
    expect(rows.map((r) => r[2])).toEqual(['Parent request', 'Legal']);
    expect(describeAuditRow({ action: 'record_export_override', details: { reason: 'audit' } }))
      .toBe('Full record exported with admin approval (Audit)');
  });

  test('plain-language labels with the reason', () => {
    expect(describeAuditRow({ action: 'record_export_override', details: { reason: 'internal_review' } }))
      .toBe('Full record exported with admin approval (Internal review)');
    expect(describeAuditRow({ action: 'record_export_override', details: JSON.stringify({ reason: 'parent_request' }) }))
      .toBe('Full record exported with admin approval (Parent request)');
    expect(describeAuditRow({ action: 'record_export_override_failed', details: { reason: 'legal' } }))
      .toMatch(/admin approval.*failed|failed.*admin approval/i);
    expect(describeAuditRow({ action: 'patient_record_export', details: {} })).toBe('Full record exported');
  });

  test('an override export is listed as a disclosure with the reason as purpose; a failed attempt is not', () => {
    const rows = buildDisclosureRows([
      { action: 'record_export_override', created_at: '2026-10-20T15:00:00Z', details: { reason: 'legal', recipientName: 'Parent/guardian or agency', records: ['Full record'] } },
      { action: 'record_export_override_failed', created_at: '2026-10-20T15:00:00Z', details: { reason: 'legal' } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('Parent/guardian or agency');
    expect(rows[0][2]).toBe('Legal');
    expect(rows[0][3]).toBe('Full record');
  });
});
