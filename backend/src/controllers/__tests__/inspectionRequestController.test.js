jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { createInspectionRequest, listInspectionRequests, listForPatient, fulfillInspectionRequest } = require('../inspectionRequestController');

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });
afterEach(() => jest.resetAllMocks());

describe('createInspectionRequest', () => {
  const body = { patientId: 42, requestedByName: 'Jane Doe', requestedByRelationship: 'Mother', requestedAt: '2026-10-25', identityVerifiedMethod: 'photo_id' };
  const mk = (b) => ({ practitioner: { practitionerId: 7 }, body: { ...body, ...b } });

  test('400 without identity method', async () => {
    const res = mkRes();
    await createInspectionRequest(mk({ identityVerifiedMethod: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('400 without requester name or bad date', async () => {
    let res = mkRes();
    await createInspectionRequest(mk({ requestedByName: ' ' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    res = mkRes();
    await createInspectionRequest(mk({ requestedAt: 'x' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  test('404 when patient does not exist', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [] });
    await createInspectionRequest(mk({}), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
  test('inserts with computed due_at and audits against the patient', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] }).mockResolvedValueOnce({ rows: [{ id: 3, patient_id: 42, due_at: '2026-11-04', status: 'open' }] });
    await createInspectionRequest(mk({}), res);
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toContain('INSERT INTO records_inspection_requests');
    expect(params).toContain('2026-11-04');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'patient', resourceId: 42, action: 'records_inspection_requested' }));
  });
});

describe('listInspectionRequests', () => {
  test('adds daysRemaining and overdue', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'open', due_at: '2000-01-01' }, { id: 2, status: 'fulfilled', due_at: '2000-01-01' }] });
    await listInspectionRequests({ query: { status: 'open' } }, res);
    expect(pool.query.mock.calls[0][1]).toEqual(['open']);
    const { requests } = res.json.mock.calls[0][0];
    expect(requests[0].overdue).toBe(true);
    expect(requests[0].daysRemaining).toBeLessThan(0);
    expect(requests[1].overdue).toBe(false);
  });
  test('400 on invalid status filter', async () => {
    const res = mkRes();
    await listInspectionRequests({ query: { status: 'bogus' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('listForPatient', () => {
  test('filters by patient', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [] });
    await listForPatient({ params: { patientId: '42' } }, res);
    expect(pool.query.mock.calls[0][1]).toEqual(['42']);
  });
});

describe('fulfillInspectionRequest', () => {
  const mk = (b) => ({ practitioner: { practitionerId: 7 }, params: { id: '3' }, body: b });
  test('400 without note', async () => {
    const res = mkRes();
    await fulfillInspectionRequest(mk({ fulfillmentNote: ' ' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('404 when not open', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [] });
    await fulfillInspectionRequest(mk({ fulfillmentNote: 'Sent copies' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
  test('fulfills and audits', async () => {
    const res = mkRes();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3, patient_id: 42, status: 'fulfilled', due_at: '2026-11-04' }] });
    await fulfillInspectionRequest(mk({ fulfillmentNote: 'Sent copies' }), res);
    expect(pool.query.mock.calls[0][0]).toContain("status = 'open'");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'patient', resourceId: 42, action: 'records_inspection_fulfilled' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
