process.env.FIELD_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.FIELD_INDEX_KEY = require('crypto').randomBytes(32).toString('base64');

jest.mock('../../config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../config/platformDb', () => ({ platformPool: { query: jest.fn() } }));
jest.mock('../../config/tenantPoolRegistry', () => ({ getTenantPool: jest.fn() }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn().mockResolvedValue('Test Agency') }));

const { pool } = require('../../config/db');
const { encryptField } = require('../../utils/fieldEncryption');

const routesOf = (router) => router.stack
  .filter((l) => l.route)
  .flatMap((l) => Object.keys(l.route.methods).map((m) => ({
    method: m.toUpperCase(), path: l.route.path, handles: l.route.stack.map((s) => s.handle),
  })));
const find = (routes, method, path) => routes.find((r) => r.method === method && r.path === path);

describe('GET /generate-pdf/:assessmentId decrypts before filling NJEIS form fields', () => {
  it('fills Childs First Name/Childs Last Name/DOB with decrypted plaintext, not ciphertext', async () => {
    const routes = routesOf(require('../patientRoutes'));
    const route = find(routes, 'GET', '/generate-pdf/:assessmentId');
    expect(route).toBeDefined();
    const handler = route.handles[route.handles.length - 1];

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, patient_id: 5, practitioner_id: 3,
        patient_first_name: encryptField('Luz'), patient_last_name: encryptField('Quintero'),
        patient_dob: encryptField('2024-03-05'),
        practitioner_first_name: 'Omar', practitioner_last_name: 'Abernathy', practitioner_discipline: 'PT',
        service_date: '2026-10-29', start_time: '10:00', end_time: '11:00', total_time: 60,
        type: 'PT', location: '1', status: '1',
        parent_signature: null, practitioner_signature: null,
      }],
    });

    const req = { params: { assessmentId: '1' }, practitioner: { practitionerId: 3 } };
    let sentBuffer = null;
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader() {},
      send(b) { sentBuffer = b; return this; },
    };

    await handler(req, res);

    expect(res.statusCode).not.toBe(500);
    expect(sentBuffer).not.toBeNull();

    const { PDFDocument } = require('pdf-lib');
    const reloaded = await PDFDocument.load(sentBuffer);
    const form = reloaded.getForm();
    expect(form.getTextField('Childs First Name').getText()).toBe('Luz');
    expect(form.getTextField('Childs Last Name').getText()).toBe('Quintero');
    expect(form.getTextField('DOB').getText()).toBe('2024-03-05');
  });
});
