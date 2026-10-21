jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
const { pool } = require('../../config/db');
const { logAudit } = require('../../utils/auditLog');
const { getPatients } = require('../patientController');
const { listDirectoryPatients } = require('../patientDirectoryController');

describe('list view events are audited with counts only', () => {
  afterEach(() => jest.resetAllMocks());
  const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

  test('getPatients logs patient_list_view with count, no names', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    pool.query.mockResolvedValueOnce({ rows: [{ first_name: 'Ann' }, { first_name: 'Bo' }] });
    await getPatients(req, mkRes());
    expect(logAudit).toHaveBeenCalledWith({ req, action: 'patient_list_view', resourceType: 'patient', details: { count: 2 } });
  });

  test('listDirectoryPatients logs patient_directory_view with count', async () => {
    const req = { practitioner: { practitionerId: 7 } };
    pool.query.mockResolvedValueOnce({ rows: [{ first_name: 'Ann' }] });
    await listDirectoryPatients(req, mkRes());
    expect(logAudit).toHaveBeenCalledWith({ req, action: 'patient_directory_view', resourceType: 'patient', details: { count: 1 } });
  });
});

// Endpoints polled every ~20s (Inbox rejected-logs badge, BillingManager's
// per-expanded-row refresh) must not write a view event per poll — that
// floods the audit trail with noise and buries the meaningful entries.
describe('high-frequency polled reads are NOT view-audited', () => {
  afterEach(() => jest.resetAllMocks());
  const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

  test('getRejectedLogs writes no audit event', async () => {
    const { getRejectedLogs } = require('../patientController');
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = mkRes();
    await getRejectedLogs({ practitioner: { practitionerId: 7 } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, logs: [{ id: 1 }] });
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('getPractitionerLogs writes no audit event', async () => {
    const { getPractitionerLogs } = require('../billingController');
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = mkRes();
    await getPractitionerLogs({ query: { practitionerId: '7' }, practitioner: { practitionerId: 1 } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, logs: [{ id: 1 }] });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe('getSessionAuditLog', () => {
  afterEach(() => jest.resetAllMocks());
  test('writes exactly one session_audit_log_view event per view', async () => {
    const { getSessionAuditLog } = require('../reportController');
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getSessionAuditLog({ query: {}, practitioner: { practitionerId: 1 } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, logs: [{ id: 1 }, { id: 2 }] });
    const views = logAudit.mock.calls.filter(([arg]) => arg.action === 'session_audit_log_view');
    expect(views).toHaveLength(1);
  });
});
