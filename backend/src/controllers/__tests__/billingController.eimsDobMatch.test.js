process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../config/tenantContext', () => ({
  getCurrentTenantDb: jest.fn(() => 'test-tenant'),
}));
jest.mock('../../constants/dropdownOptionsCache', () => ({
  getDropdownOptionsCache: jest.fn(() => ({})),
}));
const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');
const { runComplianceAnalysisForPractitioner } = require('../billingController');

beforeEach(() => {
  jest.spyOn(require('../billingController'), 'persistEimsFlags').mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

describe('EIMS compliance DOB matching against an encrypted patient_dob', () => {
  it('does NOT flag a mismatch when the EIMS upload DOB matches the decrypted stored value', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ // company_settings
        compliance_doc_filename: 'eims.xlsx', compliance_doc_uploaded_at: new Date(),
        compliance_doc_column_mapping: { child_id: 'Child ID', service_date: 'Service Date' },
        compliance_doc_path: 'p1', compliance_doc_applied_path: 'p1',
        compliance_doc_custom_fields: [{ label: 'DOB', compareTo: 'patient_dob' }],
        compliance_strictness: 'moderate',
      }] })
      .mockResolvedValueOnce({ rows: [{ // sessions — patient_dob is ciphertext
        id: 1, patient_id: 10, service_date: '2026-10-05', start_time: '09:00', end_time: '09:30',
        total_time: 30, type: 'OT', location: '1', group_size_category: 'individual',
        patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
        practitioner_first_name: 'C', practitioner_last_name: 'D',
        completed_at: new Date(), child_id: '700000001', status: 'done', billing_status: 'pending',
        practitioner_discipline: 'OT', patient_dob: encryptField('2024-03-05'), patient_county: 'Essex',
        eims_missing_status: null, form_data: {},
      }] })
      .mockResolvedValueOnce({ rows: [] }) // unlinked state-log backfill
      .mockResolvedValueOnce({ rows: [{ // raw state logs, with the EIMS upload's extra_fields.DOB matching
        id: 900, patient_id: 10, child_id: '700000001', child_name: 'Luz Quintero', practitioner_name: 'C D',
        service_date: '2026-10-05', start_time: '09:00', end_time: '09:30', logged_date: '2026-10-05',
        ifsp_event_id: null, service_label: 'OT', location_label: 'Home', group_size_label: 'Direct Child Service - Individual',
        extra_fields: { DOB: '2024-03-05' },
      }] })
      .mockResolvedValueOnce({ rows: [] }) // loadOverridesByField
      .mockResolvedValueOnce({ rows: [] }) // loadAcknowledgments
      .mockResolvedValueOnce({ rows: [] }); // historical-invoiced duplicate lookup

    const result = await runComplianceAnalysisForPractitioner(42, '2026-10-01', '2026-10-15');
    const dobField = result.results[1].fields.find((f) => f.key === 'custom:DOB');
    expect(dobField.match).toBe(true);
    expect(result.results[1].flagged).toBe(false);
  });
});
