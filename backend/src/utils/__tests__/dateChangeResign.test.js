// A practitioner changing the date on a note the parent already signed:
// the change waits for the parent's new signature, and the note is held
// from billing until then.
process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');
jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../emailClient', () => ({ sendParentSignatureRequestEmail: jest.fn() }));
jest.mock('../auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { sendParentSignatureRequestEmail } = require('../emailClient');
const {
  dateChanged, requestDateChangeResign, signDateChange, cancelDateChange, ParentEmailMissingError, DateChangeStateError,
} = require('../dateChangeResign');

// Routes each query by its SQL so tests don't depend on call order.
function route(handlers) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    for (const [re, result] of handlers) if (re.test(sql)) return typeof result === 'function' ? result(params) : result;
    return { rows: [], rowCount: 1 };
  };
  return { fn, calls, find: (re) => calls.filter((c) => re.test(c.sql)) };
}
function useClient(r) {
  const client = { query: jest.fn(r.fn), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  return client;
}

const assessmentRow = (o = {}) => ({
  id: 42, patient_id: 7, practitioner_id: 3, service_date: '2026-10-21', billing_status: 'pending',
  patient_first_name: 'Luz', patient_last_name: 'Quintero', patient_dob: '2024-03-05', patient_county: 'Essex',
  practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy', practitioner_discipline: 'PT',
  parent_signature: 'data:old-parent', practitioner_signature: 'data:prac', parent_email: 'luz.parent@example.com',
  ...o,
});
const newValues = {
  service_date: '2026-10-23', start_time: '10:00', end_time: '11:00', total_time: 60, status: '1', type: 'PT',
  location: '1', group_size_category: null, form_data: { custom_fields: {} }, session_notes: 'Worked on stacking',
};

afterEach(() => jest.resetAllMocks());

describe('dateChanged', () => {
  it('compares calendar days, whatever shape the stored date has', () => {
    expect(dateChanged('2026-10-21', '2026-10-23')).toBe(true);
    expect(dateChanged('2026-10-21', '2026-10-21')).toBe(false);
    expect(dateChanged(new Date(2026, 9, 21), '2026-10-21')).toBe(false);
    expect(dateChanged('2026-10-21T00:00:00.000Z', '2026-10-21')).toBe(false);
    expect(dateChanged('2026-10-21', undefined)).toBe(false);
  });
});

describe('requestDateChangeResign', () => {
  it('needs a parent email on file', async () => {
    const r = route([[/FROM assessments a/, { rows: [assessmentRow({ parent_email: null })] }]]);
    pool.query.mockImplementation(r.fn);
    await expect(requestDateChangeResign({ assessmentId: 42, practitionerId: 3, companySlug: 'acme', newValues, previousBillingStatus: 'pending' }))
      .rejects.toBeInstanceOf(ParentEmailMissingError);
    expect(r.find(/INSERT INTO telepractice_signature_requests/)).toHaveLength(0);
    expect(r.find(/awaiting_resign/)).toHaveLength(0);
  });

  it('saves the change as a date_change request, holds the note from billing, and emails the parent a link', async () => {
    const r = route([
      [/FROM assessments a/, { rows: [assessmentRow()] }],
      [/INSERT INTO telepractice_signature_requests/, { rows: [{ id: 'req-9' }] }],
      [/UPDATE assessments SET billing_status = 'awaiting_resign'/, { rowCount: 1 }],
    ]);
    const client = useClient(r);
    pool.query.mockImplementation(r.fn);

    const out = await requestDateChangeResign({
      assessmentId: 42, practitionerId: 3, companySlug: 'acme', newValues, previousBillingStatus: 'pending', authorRole: 'agency_practitioner',
    });
    expect(out).toEqual({ requestId: 'req-9', parentEmail: 'luz.parent@example.com' });

    const [insert] = r.find(/INSERT INTO telepractice_signature_requests/);
    expect(insert.sql).toMatch(/kind/);
    const p = insert.params;
    expect(p).toEqual(expect.arrayContaining([
      'date_change', 42, '2026-10-21', '2026-10-23', 'data:old-parent', 'data:prac', 'pending', 'luz.parent@example.com',
    ]));
    // the note itself is not changed yet, only held
    const [hold] = r.find(/awaiting_resign/);
    expect(hold.params).toEqual([42, 'pending']);
    expect(r.find(/SET service_date/)).toHaveLength(0);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));

    expect(sendParentSignatureRequestEmail).toHaveBeenCalledWith('luz.parent@example.com', expect.objectContaining({
      practitionerFirstName: 'Omar', reason: 'date_change', signUrl: expect.stringMatching(/\/acme\/sign\/[0-9a-f]{64}$/),
    }));
    // No session detail in the email (PHI minimization)
    const emailArgs = JSON.stringify(sendParentSignatureRequestEmail.mock.calls[0][1]);
    expect(emailArgs).not.toMatch(/Luz|2026-10-23|2026-10-21/);
  });

  it('rolls back if the note changed underneath (no longer in the expected status)', async () => {
    const r = route([
      [/FROM assessments a/, { rows: [assessmentRow()] }],
      [/INSERT INTO telepractice_signature_requests/, { rows: [{ id: 'req-9' }] }],
      [/UPDATE assessments SET billing_status = 'awaiting_resign'/, { rowCount: 0 }],
    ]);
    const client = useClient(r);
    pool.query.mockImplementation(r.fn);
    await expect(requestDateChangeResign({ assessmentId: 42, practitionerId: 3, companySlug: 'acme', newValues, previousBillingStatus: 'pending' }))
      .rejects.toBeInstanceOf(DateChangeStateError);
    expect(client.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(sendParentSignatureRequestEmail).not.toHaveBeenCalled();
  });
});

const requestRow = (o = {}) => ({
  id: 'req-9', kind: 'date_change', assessment_id: 42, status: 'awaiting_signature', token_hash: 'h',
  previous_service_date: '2026-10-21', previous_billing_status: 'pending', service_date: '2026-10-23',
  start_time: '10:00', end_time: '11:00', total_time: 60, session_status: '1', type: 'PT', location: '1',
  group_size_category: null, form_data: { custom_fields: {} }, practitioner_id: 3, patient_id: 7,
  edit_payload: { session_notes: 'Worked on stacking' },
  ...o,
});
const signArgs = { signatureBase64: 'data:new-parent', attestationText: 'I attest', ip: '1.2.3.4', userAgent: 'UA' };

describe('signDateChange', () => {
  it('applies the new date and the new parent signature together, and puts the note back in billing as pending', async () => {
    const r = route([[/UPDATE assessments\s+SET service_date/, { rowCount: 1 }]]);
    const client = useClient(r);
    await signDateChange(requestRow(), signArgs);

    const [apply] = r.find(/UPDATE assessments\s+SET service_date/);
    expect(apply.sql).toMatch(/parent_signature = /);
    expect(apply.sql).toMatch(/billing_status = 'pending'/);
    expect(apply.sql).toMatch(/billing_review = NULL/);
    expect(apply.sql).toMatch(/WHERE id = \$\d+ AND billing_status = 'awaiting_resign'/);
    expect(apply.params).toEqual(expect.arrayContaining(['2026-10-23', 'data:new-parent', 42]));
    const { decryptField } = require('../fieldEncryption');
    const notesParam = apply.params.find((p) => typeof p === 'string' && p.startsWith('v1:'));
    expect(decryptField(notesParam)).toBe('Worked on stacking');
    // EIMS checks and one-off Allows were for the old date
    expect(r.find(/DELETE FROM compliance_field_acknowledgments/)).toHaveLength(1);
    expect(apply.sql).toMatch(/eims_last_flagged = NULL/);

    const [done] = r.find(/UPDATE telepractice_signature_requests/);
    expect(done.sql).toMatch(/status = 'completed'/);
    expect(done.sql).toMatch(/attested = true/);
    expect(done.params).toEqual(expect.arrayContaining(['data:new-parent', 'I attest', '1.2.3.4', 'UA', 'req-9']));
    const sqls = client.query.mock.calls.map(([sql]) => sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('COMMIT');
  });

  it('a returned note is resubmitted: rejection note cleared and the practitioner\'s resubmit note kept', async () => {
    const r = route([[/UPDATE assessments\s+SET service_date/, { rowCount: 1 }]]);
    useClient(r);
    await signDateChange(requestRow({
      previous_billing_status: 'rejected',
      edit_payload: { resubmit_note: 'Fixed the date', author_role: 'agency_practitioner' },
    }), signArgs);
    const [apply] = r.find(/UPDATE assessments\s+SET service_date/);
    expect(apply.sql).toMatch(/rejection_note = NULL/);
    const [note] = r.find(/INSERT INTO assessment_notes/);
    expect(note.params).toEqual([42, 3, 'agency_practitioner', 'Fixed the date']);
  });

  it('rolls back and reports it if the note is no longer waiting for this signature', async () => {
    const r = route([[/UPDATE assessments\s+SET service_date/, { rowCount: 0 }]]);
    const client = useClient(r);
    await expect(signDateChange(requestRow(), signArgs)).rejects.toBeInstanceOf(DateChangeStateError);
    expect(client.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
  });
});

describe('cancelDateChange (Undo date change)', () => {
  it('puts the note back exactly as it was and closes the link', async () => {
    const r = route([[/FROM telepractice_signature_requests/, { rows: [requestRow({ previous_billing_status: 'rejected' })] }]]);
    pool.query.mockImplementation(r.fn);
    const client = useClient(r);
    await cancelDateChange({ requestId: 'req-9', practitionerId: 3 });
    const [restore] = r.find(/UPDATE assessments SET billing_status = \$1/);
    expect(restore.params).toEqual(['rejected', 42]);
    expect(restore.sql).toMatch(/billing_status = 'awaiting_resign'/);
    const [closed] = r.find(/UPDATE telepractice_signature_requests SET status = 'cancelled'/);
    expect(closed.params).toEqual(['req-9']);
    expect(client.query.mock.calls.map(([sql]) => sql)).toContain('COMMIT');
  });

  it('only while still waiting for the parent', async () => {
    const r = route([[/FROM telepractice_signature_requests/, { rows: [requestRow({ status: 'completed' })] }]]);
    pool.query.mockImplementation(r.fn);
    await expect(cancelDateChange({ requestId: 'req-9', practitionerId: 3 })).rejects.toBeInstanceOf(DateChangeStateError);
  });

  it('only for the practitioner\'s own date-change requests', async () => {
    const r = route([[/FROM telepractice_signature_requests/, { rows: [] }]]);
    pool.query.mockImplementation(r.fn);
    await expect(cancelDateChange({ requestId: 'req-9', practitionerId: 99 })).rejects.toThrow(/not found/i);
    const [lookup] = r.find(/FROM telepractice_signature_requests/);
    expect(lookup.sql).toMatch(/practitioner_id = \$2/);
    expect(lookup.sql).toMatch(/kind = 'date_change'/);
  });
});
