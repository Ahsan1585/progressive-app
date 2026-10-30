process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../emailClient', () => ({ sendParentSignatureRequestEmail: jest.fn() }));
jest.mock('../auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { encryptField, decryptField } = require('../fieldEncryption');
const { requestDateChangeResign, signDateChange } = require('../dateChangeResign');

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
  patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'), patient_dob: encryptField('2024-03-05'), patient_county: 'Essex',
  practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy', practitioner_discipline: 'PT',
  parent_signature: 'data:old-parent', practitioner_signature: 'data:prac', parent_email: 'luz.parent@example.com',
  session_notes: encryptField('Old note.'),
  ...o,
});
const newValues = {
  service_date: '2026-10-23', start_time: '10:00', end_time: '11:00', total_time: 60, status: '1', type: 'PT',
  location: '1', group_size_category: null, form_data: { custom_fields: {} }, session_notes: 'Worked on stacking',
};

afterEach(() => jest.resetAllMocks());

describe('requestDateChangeResign with encrypted assessments columns', () => {
  it('decrypts the patient identity snapshot before copying it into telepractice_signature_requests (a plaintext-expecting table)', async () => {
    const r = route([
      [/FROM assessments a/, { rows: [assessmentRow()] }],
      [/INSERT INTO telepractice_signature_requests/, { rows: [{ id: 'req-9' }] }],
      [/UPDATE assessments SET billing_status = 'awaiting_resign'/, { rowCount: 1 }],
    ]);
    useClient(r);
    pool.query.mockImplementation(r.fn);

    await requestDateChangeResign({
      assessmentId: 42, practitionerId: 3, companySlug: 'acme', newValues, previousBillingStatus: 'pending', authorRole: 'agency_practitioner',
    });

    const [insert] = r.find(/INSERT INTO telepractice_signature_requests/);
    expect(insert.params).toEqual(expect.arrayContaining(['Luz', 'Quintero', '2024-03-05']));
  });

  it('falls back to the current (decrypted) session_notes in edit_payload when no new note is submitted', async () => {
    const r = route([
      [/FROM assessments a/, { rows: [assessmentRow()] }],
      [/INSERT INTO telepractice_signature_requests/, { rows: [{ id: 'req-9' }] }],
      [/UPDATE assessments SET billing_status = 'awaiting_resign'/, { rowCount: 1 }],
    ]);
    useClient(r);
    pool.query.mockImplementation(r.fn);

    const { session_notes, ...rest } = newValues;
    await requestDateChangeResign({
      assessmentId: 42, practitionerId: 3, companySlug: 'acme', newValues: rest, previousBillingStatus: 'pending',
    });

    const [insert] = r.find(/INSERT INTO telepractice_signature_requests/);
    const colList = insert.sql.match(/\(([^)]+)\)/)[1].split(',').map((s) => s.trim());
    const editPayload = JSON.parse(insert.params[colList.indexOf('edit_payload')]);
    expect(editPayload.session_notes).toBe('Old note.');
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

describe('signDateChange encrypts session_notes on the way into assessments', () => {
  it('stores the new session_notes ciphertext, not plaintext', async () => {
    const r = route([[/UPDATE assessments\s+SET service_date/, { rowCount: 1 }]]);
    useClient(r);
    await signDateChange(requestRow(), signArgs);

    const [apply] = r.find(/UPDATE assessments\s+SET service_date/);
    expect(apply.params).not.toContain('Worked on stacking');
    const notesParam = apply.params.find((p) => typeof p === 'string' && p.startsWith('v1:'));
    expect(notesParam).toBeDefined();
    expect(decryptField(notesParam)).toBe('Worked on stacking');
  });
});
