// Only a date change sends the note back to the parent to re-sign; every
// other edit saves as before.
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');
jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/emailClient', () => ({ sendParentSignatureRequestEmail: jest.fn() }));
jest.mock('../../constants/dropdownOptionsCache', () => ({ ensureDropdownOptionsCacheLoaded: jest.fn(), getDropdownOptionsCache: () => ({}), getDropdownCategoriesCache: () => [] }));
jest.mock('../../config/tenantContext', () => ({ getCurrentTenantDb: jest.fn() }));
jest.mock('../../utils/createAssessment', () => {
  const actual = jest.requireActual('../../utils/createAssessment');
  return { ...actual, assertNoConflictingSession: jest.fn(), findConflictingSession: jest.fn() };
});
jest.mock('../../utils/dateChangeResign', () => {
  const actual = jest.requireActual('../../utils/dateChangeResign');
  return { ...actual, requestDateChangeResign: jest.fn(), signDateChange: jest.fn(), cancelDateChange: jest.fn() };
});
const { pool } = require('../../config/db');
const { sendParentSignatureRequestEmail } = require('../../utils/emailClient');
const { assertNoConflictingSession, findConflictingSession } = require('../../utils/createAssessment');
const resign = require('../../utils/dateChangeResign');
const { editLog, resubmitLog } = require('../patientController');
const billing = require('../billingController');
const tele = require('../telepracticeSignatureController');

const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() });
function route(handlers) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    for (const [re, result] of handlers) if (re.test(sql)) return result;
    return { rows: [], rowCount: 1 };
  };
  return { fn, calls, find: (re) => calls.filter((c) => re.test(c.sql)) };
}
const practitioner = { practitionerId: 3, role: 'agency_practitioner', slug: 'acme' };
const body = {
  service_date: '2026-10-23', type: 'PT', location: '1', start_time: '10:00', end_time: '11:00', total_time: 60,
  status: '1', group_size_category: null, custom_fields: {}, session_notes: 'Worked on stacking',
};

afterEach(() => jest.resetAllMocks());

describe('editLog', () => {
  const logRow = { id: 42, patient_id: 7, billing_status: 'pending', service_date: '2026-10-21', company_affiliation: null, session_notes: null };

  it('a new date is sent to the parent to re-sign instead of being saved', async () => {
    const r = route([[/FROM assessments WHERE id = \$1 AND practitioner_id/, { rows: [logRow] }], [/service_types/, { rows: [{ service_types: [] }] }]]);
    pool.query.mockImplementation(r.fn);
    resign.requestDateChangeResign.mockResolvedValue({ requestId: 'req-9', parentEmail: 'luz.parent@example.com' });
    const res = mkRes();
    await editLog({ practitioner, params: { id: '42' }, body }, res);

    expect(assertNoConflictingSession).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-23', excludeAssessmentId: 42 }));
    expect(resign.requestDateChangeResign).toHaveBeenCalledWith(expect.objectContaining({
      assessmentId: 42, practitionerId: 3, companySlug: 'acme', previousBillingStatus: 'pending',
      newValues: expect.objectContaining({ service_date: '2026-10-23', start_time: '10:00', session_notes: 'Worked on stacking' }),
    }));
    expect(r.find(/UPDATE assessments/)).toHaveLength(0);
    expect(res.json).toHaveBeenCalledWith({ success: true, resignRequested: true, parentEmail: 'luz.parent@example.com', requestId: 'req-9' });
  });

  it('the same date saves straight away, as before', async () => {
    const r = route([[/FROM assessments WHERE id = \$1 AND practitioner_id/, { rows: [logRow] }], [/service_types/, { rows: [{ service_types: [] }] }]]);
    pool.query.mockImplementation(r.fn);
    const res = mkRes();
    await editLog({ practitioner, params: { id: '42' }, body: { ...body, service_date: '2026-10-21', start_time: '09:00' } }, res);
    expect(resign.requestDateChangeResign).not.toHaveBeenCalled();
    expect(r.find(/UPDATE assessments/)).toHaveLength(1);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('no parent email: says so, nothing changes', async () => {
    const r = route([[/FROM assessments WHERE id = \$1 AND practitioner_id/, { rows: [logRow] }], [/service_types/, { rows: [{ service_types: [] }] }]]);
    pool.query.mockImplementation(r.fn);
    resign.requestDateChangeResign.mockRejectedValue(new resign.ParentEmailMissingError());
    const res = mkRes();
    await editLog({ practitioner, params: { id: '42' }, body }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'PARENT_EMAIL_MISSING' });
  });

  it("an independent practitioner's own log keeps today's behavior (self-certified, no parent re-sign)", async () => {
    const r = route([[/FROM assessments WHERE id = \$1 AND practitioner_id/, { rows: [{ ...logRow, billing_status: 'self_certified' }] }], [/service_types/, { rows: [{ service_types: [] }] }]]);
    pool.query.mockImplementation(r.fn);
    const res = mkRes();
    await editLog({ practitioner: { ...practitioner, role: 'independent_practitioner' }, params: { id: '42' }, body }, res);
    expect(resign.requestDateChangeResign).not.toHaveBeenCalled();
    expect(r.find(/UPDATE assessments/)).toHaveLength(1);
  });

  it('a note waiting for the parent to re-sign cannot be edited', async () => {
    const r = route([[/FROM assessments WHERE id = \$1 AND practitioner_id/, { rows: [{ ...logRow, billing_status: 'awaiting_resign' }] }]]);
    pool.query.mockImplementation(r.fn);
    const res = mkRes();
    await editLog({ practitioner, params: { id: '42' }, body }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('resubmitLog', () => {
  const returned = { id: 42, patient_id: 7, service_date: '2026-10-21', billing_status: 'rejected' };

  it('a returned note can now get a new date; it goes to the parent first, then back to billing', async () => {
    const r = route([[/FROM assessments WHERE id = \$1 AND practitioner_id/, { rows: [returned] }], [/service_types/, { rows: [{ service_types: [] }] }]]);
    pool.query.mockImplementation(r.fn);
    resign.requestDateChangeResign.mockResolvedValue({ requestId: 'req-9', parentEmail: 'p@x.com' });
    const res = mkRes();
    await resubmitLog({ practitioner, body: { ...body, assessmentId: '42', note: 'Fixed the date' } }, res);
    expect(assertNoConflictingSession).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-23' }));
    expect(resign.requestDateChangeResign).toHaveBeenCalledWith(expect.objectContaining({
      assessmentId: 42, previousBillingStatus: 'rejected', resubmitNote: 'Fixed the date', authorRole: 'agency_practitioner',
    }));
    expect(r.find(/UPDATE assessments/)).toHaveLength(0);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ resignRequested: true }));
  });

  it('without a date change, resubmits exactly as before', async () => {
    const r = route([[/FROM assessments WHERE id = \$1 AND practitioner_id/, { rows: [returned] }], [/service_types/, { rows: [{ service_types: [] }] }]]);
    pool.query.mockImplementation(r.fn);
    const res = mkRes();
    const { service_date, ...noDate } = body;
    await resubmitLog({ practitioner, body: { ...noDate, assessmentId: '42' } }, res);
    expect(resign.requestDateChangeResign).not.toHaveBeenCalled();
    expect(r.find(/SET billing_status = 'pending'/)).toHaveLength(1);
    expect(service_date).toBe('2026-10-23');
  });
});

describe('billing cannot act on a note waiting for the parent', () => {
  it('Approve / Release / Reset are refused', async () => {
    const r = route([[/SELECT billing_status FROM assessments/, { rows: [{ billing_status: 'awaiting_resign' }] }]]);
    pool.query.mockImplementation(r.fn);
    const res = mkRes();
    await billing.updateLogStatus({ body: { assessmentId: 42, status: 'pending', review: null } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(r.find(/UPDATE assessments/)).toHaveLength(0);
  });
  it('Return / Reject / Hold are refused', async () => {
    const r = route([[/SELECT billing_status FROM assessments/, { rows: [{ billing_status: 'awaiting_resign' }] }]]);
    pool.query.mockImplementation(r.fn);
    const res = mkRes();
    await billing.rejectLog({ body: { assessmentId: 42, type: 'hold', note: 'x' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(r.find(/UPDATE assessments/)).toHaveLength(0);
  });
  it('the billing queue lists them (read-only) so billers can see why a note is missing', async () => {
    const r = route([]);
    pool.query.mockImplementation(r.fn);
    await billing.getPractitionerLogs({ query: { practitionerId: '3' } }, mkRes());
    expect(r.calls[0].params[1]).toContain('awaiting_resign');
  });
});

describe('parent signing link for a date change', () => {
  const dc = (o = {}) => ({
    id: 'req-9', kind: 'date_change', status: 'awaiting_signature', token_expires: new Date(Date.now() + 1e6).toISOString(),
    token_hash: 'h', patient_dob: '2024-03-05', patient_first_name: 'Luz', patient_last_name: 'Quintero',
    verify_failed_attempts: 0, verify_locked_at: null, parent_email: 'p@x.com',
    previous_service_date: '2026-10-21', service_date: '2026-10-23', assessment_id: 42, practitioner_id: 3, patient_id: 7,
    type: 'PT', start_time: '10:00', end_time: '11:00', ...o,
  });
  const req = (b = {}) => ({ params: { token: 'tok', companySlug: 'acme' }, body: b, headers: { 'user-agent': 'UA' }, ip: '1.2.3.4' });

  it('the summary shows the date change', async () => {
    pool.query.mockResolvedValueOnce({ rows: [dc()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await tele.verifyTelepracticeSignatureIdentity(req({ dob: '2024-03-05' }), res);
    const { summary } = res.json.mock.calls[0][0];
    expect(summary.dateChange).toEqual({ from: expect.stringMatching(/October 21/), to: expect.stringMatching(/October 23/) });
  });

  it('signing applies the change to the note (no practitioner confirm step)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [dc()] })
      .mockResolvedValueOnce({ rows: [{ verify_failed_attempts: 1, verify_locked_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    findConflictingSession.mockResolvedValue(null);
    const res = mkRes();
    await tele.signTelepracticeSession(req({ signatureBase64: 'data:sig', attested: true, dob: '2024-03-05' }), res);
    expect(findConflictingSession).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-23', excludeAssessmentId: 42 }));
    expect(resign.signDateChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'req-9' }), expect.objectContaining({
      signatureBase64: 'data:sig', attestationText: tele.ATTESTATION_TEXT, ip: '1.2.3.4', userAgent: 'UA',
    }));
    expect(pool.query.mock.calls.some(([sql]) => /status = 'signed'/.test(sql))).toBe(false);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('a cancelled link tells the parent it is no longer needed', async () => {
    pool.query.mockResolvedValueOnce({ rows: [dc({ status: 'cancelled' })] });
    const res = mkRes();
    await tele.getTelepracticeSignatureSummary(req(), res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json.mock.calls[0][0].error).toBe('cancelled');
  });

  it('resend uses the date-change wording', async () => {
    pool.query.mockResolvedValueOnce({ rows: [dc({ sent_at: new Date(Date.now() - 1e7).toISOString(), practitioner_first_name: 'Omar' })] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = mkRes();
    await tele.resendTelepracticeSignatureRequest({ params: { id: 'req-9' }, practitioner }, res);
    expect(sendParentSignatureRequestEmail).toHaveBeenCalledWith('p@x.com', expect.objectContaining({ reason: 'date_change', isResend: true }));
  });

  it('Undo date change', async () => {
    resign.cancelDateChange.mockResolvedValue({ id: 'req-9' });
    const res = mkRes();
    await tele.cancelDateChangeRequest({ params: { id: 'req-9' }, practitioner }, res);
    expect(resign.cancelDateChange).toHaveBeenCalledWith({ requestId: 'req-9', practitionerId: 3 });
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('session compliance status for Session Detail', () => {
  it('includes the field comparison so the review panel can pre-fill a Return/Hold/Reject note', async () => {
    const fields = [{ key: 'location', label: 'Location', ours: '1', state: '6', match: false }];
    jest.spyOn(billing, 'computeSessionCompliance').mockResolvedValue({ documentOnFile: true, matched: true, flagged: true, fields });
    const res = mkRes();
    await billing.getSessionComplianceStatus({ query: { assessmentId: '42' } }, res);
    expect(res.json.mock.calls[0][0]).toMatchObject({ flagged: true, fields });
  });
});
