// Draft lists (Home's "Continue where you left off", the child's "Resume draft")
// carry a short summary of what was entered, so a practitioner can tell two
// drafts apart. The summary never includes the signature images themselves.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { listDrafts, listDraftsForPatient, summarizeDraft } = require('../sessionDraftsController');

const mkRes = () => {
  const res = { statusCode: 200, set: jest.fn() };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.set.mockReturnValue(res);
  return res;
};
const row = (over = {}) => ({
  id: 'd1', patient_id: 'p1', updated_at: '2026-10-25T20:00:00Z',
  form_data: { date: '2026-10-25', startTime: '19:49', endTime: '20:49', type: 'SLP', status: '1', location: '1', note: 'Worked on words.', zeroTime: false },
  parent_signature: 'data:image/png;base64,AAAA', practitioner_signature: null,
  ...over,
});

beforeEach(() => pool.query.mockReset());

describe('summarizeDraft', () => {
  it('keeps the details that identify the session, and only whether each signature exists', () => {
    expect(summarizeDraft(row())).toEqual({
      date: '2026-10-25', startTime: '19:49', endTime: '20:49', zeroTime: false,
      type: 'SLP', status: '1', location: '1', hasNote: true,
      hasParentSignature: true, hasPractitionerSignature: false,
    });
  });

  it('copes with a draft saved almost empty', () => {
    expect(summarizeDraft(row({ form_data: {}, parent_signature: null }))).toEqual({
      date: null, startTime: null, endTime: null, zeroTime: false,
      type: null, status: null, location: null, hasNote: false,
      hasParentSignature: false, hasPractitionerSignature: false,
    });
  });
});

describe('draft lists include the summary but never the signature images', () => {
  it("the child's list", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // owns patient
      .mockResolvedValueOnce({ rows: [row()] });
    const res = mkRes();
    await listDraftsForPatient({ params: { patientId: 'p1' }, practitioner: { practitionerId: 7 } }, res);
    const [draft] = res.body.drafts;
    expect(draft).toMatchObject({ id: 'd1', updated_at: '2026-10-25T20:00:00Z', summary: { type: 'SLP', hasParentSignature: true } });
    expect(JSON.stringify(res.body)).not.toMatch(/base64/);
  });

  it("the practitioner's list across children", async () => {
    pool.query
      .mockResolvedValueOnce({}) // purge of old drafts
      .mockResolvedValueOnce({ rows: [row({ patient_first_name: 'Luz', patient_last_name: 'Quintero' })] });
    const res = mkRes();
    await listDrafts({ practitioner: { practitionerId: 7 } }, res);
    expect(res.body.drafts[0]).toMatchObject({ patient_first_name: 'Luz', summary: { startTime: '19:49' } });
    expect(JSON.stringify(res.body)).not.toMatch(/base64/);
  });
});
