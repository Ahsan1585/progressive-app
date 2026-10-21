// End-to-end: the disclosure packet is a real, parseable PDF with exactly the
// expected pages (real section builders, real SEVF template).
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn() }));

const { PDFDocument } = require('pdf-lib');
const { pool } = require('../../config/db');
const { getCompanyName } = require('../../utils/companyName');
const { generateConsentReport } = require('../consentReportController');

afterEach(() => jest.resetAllMocks());

const ASSESSMENTS = [
  { id: 1, patient_id: 10, practitioner_id: 7, practitioner_first_name: 'Sam', practitioner_last_name: 'Staff', service_date: '2026-09-01', start_time: '09:00', end_time: '10:00', total_time: 60, type: 'SI', location: 'Home', billing_status: 'billed', company_affiliation: 'Acme' },
  { id: 2, patient_id: 10, practitioner_id: 7, practitioner_first_name: 'Sam', practitioner_last_name: 'Staff', service_date: '2026-09-08', start_time: '09:00', end_time: '10:00', total_time: 60, type: 'SI', location: 'Home', billing_status: 'billed', company_affiliation: 'Acme' },
];

function prime(consent, assessments = ASSESSMENTS, patient = { id: 10, first_name: 'Zoë', last_name: 'Kim', dob: '2024-03-05', child_id: 'NJ-1' }) {
  getCompanyName.mockResolvedValue('Acme EI');
  pool.query.mockImplementation(async (sql) => {
    if (/FROM records_consents/.test(sql)) return { rows: [consent] };
    if (/FROM patients/.test(sql)) return { rows: [patient] };
    if (/FROM practitioners/.test(sql)) return { rows: [{ id: 3, first_name: 'Olive', last_name: 'Office' }, { id: 7, first_name: 'Sam', last_name: 'Staff' }] };
    if (/FROM assessments/.test(sql)) return { rows: assessments };
    throw new Error(`unexpected query: ${sql}`);
  });
}

const base = {
  id: 55, patient_id: 10, recipient_name: '서울 Clinic 📄', recipient_email: 'x@y.org', purpose: 'Łódź review',
  granted_at: '2026-10-01T14:05:00Z', expires_at: new Date(Date.now() + 1e10).toISOString(), revoked_at: null, granted_by: 7,
};
const electronic = { ...base, source: 'electronic', signed_name: 'Zoë’s Mom', signed_ip: '1.2.3.4', signed_user_agent: 'Mozilla/5.0', identity_verified_method: 'electronic_dob', attestation_text: 'I am the parent.' };
const paper = { ...base, source: 'paper', signed_on: '2026-09-28', identity_verified_method: 'in_person', identity_verified_note: 'At intake', proof_note: 'In chart', paper_attested: true };

async function run(consent) {
  const res = { setHeader: jest.fn(), set: jest.fn(), send: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await generateConsentReport({ params: { id: '10', consentId: '55' }, headers: {}, practitioner: { practitionerId: 3, email: 'o@x.com' } }, res);
  errSpy.mockRestore();
  expect(res.status).not.toHaveBeenCalled();
  return PDFDocument.load(res.send.mock.calls[0][0]);
}

test('electronic consent for SEVF only: cover + signed consent copy + SEVF pages', async () => {
  prime({ ...electronic, record_types: ['sevf_forms'] });
  const doc = await run({ ...electronic, record_types: ['sevf_forms'] });
  expect(doc.getPageCount()).toBe(3); // 2 sessions fit on one SEVF page
});

test('paper consent for the full record: cover + copy + session logs + SEVF + invoices', async () => {
  prime({ ...paper, record_types: ['full_record_export'] });
  const doc = await run({ ...paper, record_types: ['full_record_export'] });
  expect(doc.getPageCount()).toBe(5);
});

test("a full-record packet for 'Łukasz Nguyễn' (SEVF included) is generated, not a 500", async () => {
  const consent = { ...paper, record_types: ['full_record_export'] };
  prime(consent, ASSESSMENTS, { id: 10, first_name: 'Łukasz', last_name: 'Nguyễn', dob: '2024-03-05', child_id: 'NJ-1', county: 'Łódź' });
  const doc = await run(consent);
  expect(doc.getPageCount()).toBe(5);
});

test('approved sections with no data each get a single "No ... on file" page', async () => {
  prime({ ...paper, record_types: ['session_logs', 'invoices'] }, []);
  const doc = await run({ ...paper, record_types: ['session_logs', 'invoices'] });
  expect(doc.getPageCount()).toBe(4);
});
