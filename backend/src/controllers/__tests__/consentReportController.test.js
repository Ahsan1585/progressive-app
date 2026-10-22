// Consent-scoped disclosure packet (GET /api/patients/:id/consents/:consentId/report).
// The shared section builders are mocked so each test can assert exactly
// which sections a consent's record_types produce.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn() }));
jest.mock('../patientRecordExportController', () => {
  const actual = jest.requireActual('../patientRecordExportController');
  return {
    ...actual,
    drawSessionLogSection: jest.fn(),
    appendSevfSection: jest.fn(),
    drawBillingSection: jest.fn(),
  };
});

const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { getCompanyName } = require('../../utils/companyName');
const exportCtrl = require('../patientRecordExportController');
const {
  generateConsentReport,
  sectionsForRecordTypes,
  buildCoverRows,
  buildConsentCopy,
  drawConsentCopyPage,
  recipientSlug,
} = require('../consentReportController');

afterEach(() => jest.resetAllMocks());

const future = () => new Date(Date.now() + 1e10).toISOString();
const past = () => new Date(Date.now() - 1e6).toISOString();
const PATIENT = { id: 10, first_name: 'Timmy', last_name: "O'Brien", dob: '2024-03-05', child_id: 'NJ-123' };
const ASSESSMENTS = [{ id: 1, patient_id: 10, practitioner_id: 7, service_date: '2026-09-01', type: 'SI', total_time: 60 }];
const consentRow = (o = {}) => ({
  id: 55, patient_id: 10, recipient_name: 'ABC Billing', recipient_email: 'billing@abc.org', purpose: 'Billing review',
  record_types: ['sevf_forms'], granted_at: '2026-10-01T14:05:00Z', signed_on: null, expires_at: future(), revoked_at: null,
  source: 'electronic', signed_name: 'Pat Parent', signed_ip: '1.2.3.4', signed_user_agent: 'Mozilla/5.0 (iPhone)',
  identity_verified_method: 'electronic_dob', identity_verified_note: 'DOB confirmed', proof_note: null, paper_attested: null,
  granted_by: 7, request_id: 'req1', attestation_text: 'I am the parent. I authorize this.', ...o,
});

const mkReq = (o = {}) => ({
  params: { id: '10', consentId: '55' }, query: {}, headers: {},
  practitioner: { practitionerId: 3, email: 'office@x.com', role: 'ceo' }, ...o,
});
const mkRes = () => ({
  setHeader: jest.fn(), set: jest.fn(), send: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn(),
});

// Routes pool.query by SQL so tests are independent of call order.
function primeDb({ consent = consentRow(), patient = PATIENT, assessments = ASSESSMENTS } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (/FROM records_consents/.test(sql)) return { rows: consent ? [consent] : [] };
    if (/FROM patients/.test(sql)) return { rows: patient ? [patient] : [] };
    if (/FROM practitioners/.test(sql)) return { rows: [{ id: 3, first_name: 'Olive', last_name: 'Office' }, { id: 7, first_name: 'Sam', last_name: 'Staff' }] };
    if (/FROM assessments/.test(sql)) return { rows: assessments };
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('sectionsForRecordTypes', () => {
  test.each([
    [['sevf_forms'], ['sevf_forms']],
    [['session_logs'], ['session_logs']],
    [['invoices'], ['invoices']],
    [['invoices', 'session_logs'], ['session_logs', 'invoices']],
    [['full_record_export'], ['session_logs', 'sevf_forms', 'invoices']],
    [['full_record_export', 'sevf_forms'], ['session_logs', 'sevf_forms', 'invoices']],
    [['bogus'], []],
    [null, []],
  ])('%j -> %j', (types, expected) => {
    expect(sectionsForRecordTypes(types)).toEqual(expected);
  });
});

describe('generateConsentReport: only the approved sections are built', () => {
  test.each([
    [['sevf_forms'], { sevf: 1, session: 0, billing: 0 }],
    [['session_logs'], { sevf: 0, session: 1, billing: 0 }],
    [['invoices'], { sevf: 0, session: 0, billing: 1 }],
    [['session_logs', 'invoices'], { sevf: 0, session: 1, billing: 1 }],
    [['full_record_export'], { sevf: 1, session: 1, billing: 1 }],
  ])('%j', async (recordTypes, counts) => {
    getCompanyName.mockResolvedValue('Acme EI');
    primeDb({ consent: consentRow({ record_types: recordTypes }) });
    exportCtrl.appendSevfSection.mockResolvedValue(1);
    const res = mkRes();
    await generateConsentReport(mkReq(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(exportCtrl.appendSevfSection).toHaveBeenCalledTimes(counts.sevf);
    expect(exportCtrl.drawSessionLogSection).toHaveBeenCalledTimes(counts.session);
    expect(exportCtrl.drawBillingSection).toHaveBeenCalledTimes(counts.billing);
    // Builders get only this child's rows.
    [exportCtrl.drawSessionLogSection, exportCtrl.drawBillingSection].forEach((fn) => {
      fn.mock.calls.forEach(([, rows]) => expect(rows).toBe(ASSESSMENTS));
    });
    exportCtrl.appendSevfSection.mock.calls.forEach(([, rows, patient]) => {
      expect(rows).toBe(ASSESSMENTS);
      expect(patient).toBe(PATIENT);
    });
    // The parent's-own-inspection sections never appear in a disclosure packet.
    const sqls = pool.query.mock.calls.map(([s]) => s);
    expect(sqls.some((s) => /audit_logs/.test(s))).toBe(false);
    expect(sqls.filter((s) => /records_consents/.test(s))).toHaveLength(1);
    const assessCall = pool.query.mock.calls.find(([s]) => /FROM assessments/.test(s));
    expect(assessCall[0]).toMatch(/WHERE patient_id = \$1/);
    expect(assessCall[1]).toEqual(['10']);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="consent-report-OBrien-abc-billing.pdf"');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    const body = res.send.mock.calls[0][0];
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.slice(0, 5).toString()).toBe('%PDF-');
  });

  test('an approved section with no data for the child gets a "No ... on file" page, not a failure', async () => {
    getCompanyName.mockResolvedValue('Acme EI');
    primeDb({ consent: consentRow({ record_types: ['full_record_export'] }), assessments: [] });
    const res = mkRes();
    await generateConsentReport(mkReq(), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(exportCtrl.appendSevfSection).not.toHaveBeenCalled();
    expect(exportCtrl.drawSessionLogSection).not.toHaveBeenCalled();
    expect(exportCtrl.drawBillingSection).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });

  test('a SEVF generation failure is a 500 (never a packet silently missing an approved section)', async () => {
    getCompanyName.mockResolvedValue('Acme EI');
    primeDb();
    exportCtrl.appendSevfSection.mockRejectedValue(new Error('template broke'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await generateConsentReport(mkReq(), res);
    errSpy.mockRestore();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe('generateConsentReport: staff names', () => {
  test('looks up the generating staff member and the consent\'s granted_by for the cover and the paper confirmation', async () => {
    getCompanyName.mockResolvedValue('Acme EI');
    primeDb({ consent: consentRow({ source: 'paper', signed_on: '2026-09-28' }) });
    exportCtrl.appendSevfSection.mockResolvedValue(1);
    const res = mkRes();
    await generateConsentReport(mkReq(), res);
    const call = pool.query.mock.calls.find(([s]) => /FROM practitioners/.test(s));
    expect(call).toBeDefined();
    expect(call[1]).toEqual([[3, 7]]);
    expect(call[0]).not.toMatch(/ssn|ein|tax/i);
    expect(res.send).toHaveBeenCalled();
  });
});

describe('generateConsentReport: refusals', () => {
  test.each([
    ['revoked', consentRow({ revoked_at: past() })],
    ['expired', consentRow({ expires_at: past() })],
  ])('%s consent -> 409 and nothing generated', async (_l, consent) => {
    primeDb({ consent });
    const res = mkRes();
    await generateConsentReport(mkReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'This consent is revoked or expired, so a report cannot be generated.' });
    expect(res.send).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([s]) => /FROM assessments/.test(s))).toBe(false);
    expect(exportCtrl.appendSevfSection).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test("another child's consent id -> 404 (the lookup is scoped by both id and patient_id)", async () => {
    primeDb({ consent: null });
    const res = mkRes();
    await generateConsentReport(mkReq(), res);
    const [sql, params] = pool.query.mock.calls.find(([s]) => /FROM records_consents/.test(s));
    expect(sql).toMatch(/WHERE id = \$1 AND patient_id = \$2/);
    expect(params).toEqual(['55', '10']);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
    expect(res.send).not.toHaveBeenCalled();
  });

  test('unknown child -> 404', async () => {
    primeDb({ patient: null });
    const res = mkRes();
    await generateConsentReport(mkReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  test.each([
    [{ id: 'abc', consentId: '55' }],
    [{ id: '10', consentId: '0' }],
    [{ id: '10', consentId: '1; DROP TABLE x' }],
    [{ id: '99999999999', consentId: '55' }],
  ])('bad ids %j -> 404 with no query', async (params) => {
    const res = mkRes();
    await generateConsentReport(mkReq({ params }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('generateConsentReport: audit', () => {
  test('writes consent_report_generated with consentId, recordTypes, recipient and purpose only', async () => {
    getCompanyName.mockResolvedValue('Acme EI');
    primeDb({ consent: consentRow({ record_types: ['sevf_forms', 'invoices'] }) });
    exportCtrl.appendSevfSection.mockResolvedValue(1);
    const req = mkReq();
    await generateConsentReport(req, mkRes());
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith({
      req, action: 'consent_report_generated', resourceType: 'patient', resourceId: '10',
      details: { consentId: 55, recordTypes: ['sevf_forms', 'invoices'], recipient: 'ABC Billing', purpose: 'Billing review' },
    });
    expect(JSON.stringify(logAudit.mock.calls[0][0].details)).not.toMatch(/Timmy|O'Brien|billing@abc\.org/);
  });
});

describe('generateConsentReport: headers before audit', () => {
  test('a header failure leaves no consent_report_generated row', async () => {
    getCompanyName.mockResolvedValue('Acme EI');
    primeDb();
    exportCtrl.appendSevfSection.mockResolvedValue(1);
    const res = mkRes();
    res.setHeader.mockImplementation(() => { throw new Error('ERR_INVALID_CHAR'); });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await generateConsentReport(mkReq(), res);
    errSpy.mockRestore();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test.each([['O’Brien', 'OBrien'], ['Łukasz', 'Lukasz'], ['A"B\r\nC', 'ABC'], ['서울', 'child']])('last name %j -> filename segment %s', async (lastName, slug) => {
    getCompanyName.mockResolvedValue('Acme EI');
    primeDb({ patient: { ...PATIENT, last_name: lastName } });
    exportCtrl.appendSevfSection.mockResolvedValue(1);
    const res = mkRes();
    await generateConsentReport(mkReq(), res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="consent-report-${slug}-abc-billing.pdf"`);
  });
});

describe('Record of Disclosures shows a prepared packet (preparing is not sending)', () => {
  test('consent_report_generated -> "Disclosure packet prepared for <recipient>"', () => {
    const rows = exportCtrl.buildDisclosureRows([{
      action: 'consent_report_generated', created_at: '2026-10-20T15:00:00Z',
      details: { consentId: 55, recordTypes: ['sevf_forms', 'invoices'], recipient: 'ABC Billing', purpose: 'Billing review' },
    }]);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('Disclosure packet prepared for ABC Billing');
    expect(rows[0][2]).toBe('Billing review');
    expect(rows[0][3]).toBe('SEVF forms, Invoices');
  });
});

describe('Record of Disclosures shows in-app sends and downloads', () => {
  test('records_release_sent -> sent to <recipient> with the sent record types', () => {
    const rows = exportCtrl.buildDisclosureRows([{
      action: 'records_release_sent', created_at: '2026-10-20T15:00:00Z',
      details: { consentId: 55, releaseId: 3, recipient: 'ABC Billing', recipientEmail: 'billing@abc.org', recordTypes: ['sevf_forms'] },
    }]);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('Records sent to ABC Billing <billing@abc.org> (secure link)');
    expect(rows[0][3]).toBe('SEVF forms');
  });

  test('records_release_downloaded -> downloaded by the recipient', () => {
    const rows = exportCtrl.buildDisclosureRows([{
      action: 'records_release_downloaded', created_at: '2026-10-21T15:00:00Z',
      details: { consentId: 55, releaseId: 3, recipient: 'ABC Billing', recordTypes: ['sevf_forms', 'invoices'] },
    }]);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('Records downloaded by ABC Billing');
    expect(rows[0][3]).toBe('SEVF forms, Invoices');
  });

  test('revoking a link is not a disclosure', () => {
    expect(exportCtrl.buildDisclosureRows([{ action: 'records_release_revoked', created_at: '2026-10-21T15:00:00Z', details: {} }])).toHaveLength(0);
  });
});

describe('cover rows', () => {
  test('child, recipient, purpose, human record labels, expiry, generated by', () => {
    const rows = buildCoverRows({
      patient: PATIENT, consent: consentRow({ record_types: ['session_logs', 'full_record_export'] }),
      companyName: 'Acme EI', generatedBy: 'Olive Office', generatedAt: new Date('2026-10-21T16:30:00Z'),
    });
    const m = Object.fromEntries(rows);
    expect(m['Child:']).toBe("Timmy O'Brien");
    expect(m['Date of birth:']).toBe('3/5/2024');
    expect(m['Child ID:']).toBe('NJ-123');
    expect(m['Prepared for:']).toBe('ABC Billing');
    expect(m['Purpose:']).toBe('Billing review');
    expect(m['Records included:']).toBe('Session logs, Full record');
    expect(m['Consent valid through:']).toMatch(/\d+\/\d+\/\d{4}/);
    expect(m['Generated:']).toMatch(/October 21, 2026/);
    expect(m['Generated by:']).toBe('Olive Office');
  });
});

describe('signed consent copy', () => {
  const labels = (copy) => Object.fromEntries(copy.rows);

  test('electronic: typed signature, signing time, IP, device, DOB verification, verbatim attestation', () => {
    const copy = buildConsentCopy(consentRow({ signed_user_agent: `Mozilla/5.0 ${'x'.repeat(400)}` }), { grantedByName: 'Sam Staff' });
    expect(copy.title).toBe('Parental consent record');
    expect(copy.method).toBe('electronic');
    expect(copy.signature).toEqual({ name: 'Pat Parent' });
    const m = labels(copy);
    expect(m['Shared with:']).toBe('ABC Billing <billing@abc.org>');
    expect(m['Purpose:']).toBe('Billing review');
    expect(m['Records approved:']).toBe('SEVF forms');
    expect(m['Valid from:']).toBe('10/1/2026');
    expect(m['Valid through:']).toMatch(/\d+\/\d+\/\d{4}/);
    expect(m['How obtained:']).toBe('Electronic signature');
    expect(m['Signed:']).toMatch(/October 1, 2026.*10:05/);
    expect(m['IP address:']).toBe('1.2.3.4');
    expect(m['Device:'].length).toBeLessThanOrEqual(160);
    expect(m['Identity verified by:']).toBe('Electronic signature, child date of birth verified');
    expect(m['Attestation:']).toBe('I am the parent. I authorize this.');
    expect(m['Consent ID:']).toBe('55');
  });

  test('electronic without stored attestation says it was not recorded rather than inventing it', () => {
    const m = labels(buildConsentCopy(consentRow({ attestation_text: null }), {}));
    expect(m['Attestation:']).toBe('Attestation wording was not recorded for this consent');
  });

  test('paper: signed-on date, confirmed by staff, identity method label and note, proof note', () => {
    const copy = buildConsentCopy(consentRow({
      source: 'paper', signed_on: '2026-09-28', signed_name: null, signed_ip: null, signed_user_agent: null,
      identity_verified_method: 'photo_id', identity_verified_note: "Driver's license", proof_note: 'Scanned into chart', attestation_text: null,
    }), { grantedByName: 'Sam Staff' });
    expect(copy.method).toBe('paper');
    expect(copy.signature).toBeNull();
    const m = labels(copy);
    expect(m['How obtained:']).toBe('Paper consent signed on 9/28/2026, confirmed on file by Sam Staff');
    expect(m['Identity verified by:']).toBe("Photo ID checked: Driver's license");
    expect(m['Proof note:']).toBe('Scanned into chart');
    expect(m['Attestation:']).toBe('Paper consent confirmed on file by the agency');
    expect(m['Valid from:']).toBe('9/28/2026');
    expect(m).not.toHaveProperty('IP address:');
  });

  test('legacy (source NULL) rows are labeled as recorded by staff, attestation not recorded', () => {
    const m = labels(buildConsentCopy(consentRow({ source: null, signed_name: null, attestation_text: null }), { grantedByName: 'Sam Staff' }));
    expect(m['How obtained:']).toMatch(/recorded by Sam Staff/i);
    expect(m['Attestation:']).toBe('Attestation wording was not recorded for this consent');
  });

  test('unencodable characters are transliterated or sanitized', () => {
    const m = labels(buildConsentCopy(consentRow({ recipient_name: 'Łódź Clinic', purpose: 'Billing 📄' }), {}));
    expect(m['Shared with:']).toBe('Lódz Clinic <billing@abc.org>');
    expect(m['Purpose:']).toBe('Billing ?');
  });

  test('drawConsentCopyPage draws the typed name on the Signature line in Times Roman Italic', async () => {
    const drawn = [];
    const page = { drawText: jest.fn((text, opts) => drawn.push({ text, font: opts.font })), drawLine: jest.fn(), drawRectangle: jest.fn() };
    const fontFor = (name) => ({ name, widthOfTextAtSize: (t, size) => t.length * size * 0.5 });
    const doc = { addPage: jest.fn(() => page), embedFont: jest.fn(async (name) => fontFor(name)) };
    const fonts = { regular: fontFor('Helvetica'), bold: fontFor('Helvetica-Bold') };
    await drawConsentCopyPage(doc, buildConsentCopy(consentRow(), {}), fonts);
    expect(doc.embedFont).toHaveBeenCalledWith('Times-Italic');
    const sig = drawn.find((d) => d.text === 'Pat Parent');
    expect(sig.font.name).toBe('Times-Italic');
    expect(drawn.some((d) => /^Signature/.test(d.text))).toBe(true);
    expect(drawn.some((d) => d.text === 'Parental consent record')).toBe(true);
  });
});

describe('recipientSlug', () => {
  test.each([
    ['ABC Billing, LLC', 'abc-billing-llc'],
    ['  ***  ', 'recipient'],
    ['Łódź "Clinic"\r\n', 'd-clinic'],
  ])('%j -> %j', (input, expected) => {
    expect(recipientSlug(input)).toBe(expected);
  });
});
