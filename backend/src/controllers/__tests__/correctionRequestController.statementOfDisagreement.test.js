// Parent's "Statement of Disagreement" after a denied correction request
// (34 CFR 303.412-413 / FERPA 34 CFR 99.21).
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));

const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { recordStatementOfDisagreement } = require('../correctionRequestController');

afterEach(() => jest.resetAllMocks());

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const req = (o = {}) => ({
  params: { requestId: '9' },
  body: { statementText: 'We disagree with this denial because...' },
  practitioner: { practitionerId: 3, role: 'ceo' },
  ...o,
});

test('400 when statementText is blank', async () => {
  const res = mockRes();
  await recordStatementOfDisagreement(req({ body: { statementText: '  ' } }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(pool.query).not.toHaveBeenCalled();
});

test('404 when the correction request does not exist', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] });
  const res = mockRes();
  await recordStatementOfDisagreement(req(), res);
  expect(res.status).toHaveBeenCalledWith(404);
});

test('400 when the request is not denied', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ id: 9, patient_id: 10, status: 'pending', statement_of_disagreement: null }] });
  const res = mockRes();
  await recordStatementOfDisagreement(req(), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/denied/i) });
});

test('400 when a statement is already recorded', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ id: 9, patient_id: 10, status: 'denied', statement_of_disagreement: 'already here' }] });
  const res = mockRes();
  await recordStatementOfDisagreement(req(), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/already/i) });
});

test('records the statement, audits it, and returns the updated row', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 9, patient_id: 10, status: 'denied', statement_of_disagreement: null }] })
    .mockResolvedValueOnce({ rows: [{ id: 9, patient_id: 10, status: 'denied', statement_of_disagreement: 'We disagree with this denial because...' }] });
  const res = mockRes();
  await recordStatementOfDisagreement(req(), res);

  expect(pool.query).toHaveBeenLastCalledWith(
    expect.stringMatching(/UPDATE correction_requests/),
    ['We disagree with this denial because...', 3, '9']
  );
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'correction_request_statement_recorded',
    resourceType: 'patient',
    resourceId: 10,
  }));
  expect(res.json).toHaveBeenCalledWith({ success: true, request: expect.objectContaining({ id: 9 }) });
});
