// getSessionDetail (the Overview dashboard's session drill-down dialog)
// reuses computeSessionCompliance's field-by-field comparison as-is. For a
// session billed via is_override (the session-level "exceptionally
// approve" action, as opposed to a field-level Allow), computeSessionCompliance
// has no notion of is_override at all -- so a field that's still a genuine,
// live EIMS mismatch renders as a plain red X with no explanation of why it
// was billed anyway, even though the same "Allowed" badge is shown for a
// field-level Allow (buildFieldsForSession's originalMismatch flag). Both
// approval mechanisms should get the same treatment in this dialog.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../billingController', () => ({ computeSessionCompliance: jest.fn() }));
jest.mock('../../utils/fieldEncryption', () => ({ decryptField: (v) => v }));

const { pool } = require('../../config/db');
const { computeSessionCompliance } = require('../billingController');
const { getSessionDetail } = require('../dashboardController');

beforeEach(() => {
  pool.query.mockReset();
  computeSessionCompliance.mockReset();
});

const mkRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

describe('getSessionDetail — is_override sessions', () => {
  test('a still-mismatched field on an is_override session gets originalMismatch:true', async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: 10, billing_status: 'invoiced', service_date: '2026-05-21', is_override: true,
        patient_first_name: 'Hazel', patient_last_name: 'Hughes',
        practitioner_id: 1, practitioner_first_name: 'Hector', practitioner_last_name: 'Nguyen',
      }],
    });
    computeSessionCompliance.mockResolvedValue({
      matched: true, flagged: true, documentOnFile: true,
      fields: [
        { key: 'child_id', label: 'Child ID', ours: '7110000036', state: '7110000036', match: true },
        { key: 'start_time', label: 'Start Time', ours: '15:50', state: '15:35', match: false },
      ],
    });

    const res = mkRes();
    await getSessionDetail({ query: { assessmentId: '10' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    const startTime = body.compliance.fields.find((f) => f.key === 'start_time');
    expect(startTime.originalMismatch).toBe(true);
    expect(startTime.match).toBe(false); // untouched — still renders red on its own

    const childId = body.compliance.fields.find((f) => f.key === 'child_id');
    expect(childId.originalMismatch).toBeUndefined();
  });

  test('a non-override session leaves fields untouched', async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: 11, billing_status: 'invoiced', service_date: '2026-05-21', is_override: false,
        patient_first_name: 'Harper', patient_last_name: 'Xu',
        practitioner_id: 1, practitioner_first_name: 'Hector', practitioner_last_name: 'Nguyen',
      }],
    });
    computeSessionCompliance.mockResolvedValue({
      matched: true, flagged: true, documentOnFile: true,
      fields: [{ key: 'start_time', label: 'Start Time', ours: '15:50', state: '15:35', match: false }],
    });

    const res = mkRes();
    await getSessionDetail({ query: { assessmentId: '11' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.compliance.fields[0].originalMismatch).toBeUndefined();
  });
});
