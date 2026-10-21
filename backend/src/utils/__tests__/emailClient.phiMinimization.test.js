// Resend (our transactional email vendor) cannot sign a BAA, so no child
// PHI/PII may pass through it. These tests pin down that the two emails
// that used to carry child data no longer do.
const mockSend = jest.fn().mockResolvedValue({ data: { id: 'msg_1' } });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

process.env.RESEND_API_KEY = 'test-key';

const {
  sendSevfToAgencyEmail,
  sendSessionScheduledEmail,
  generalizeSessionLocation,
  REDISCLOSURE_NOTICE,
} = require('../emailClient');

afterEach(() => mockSend.mockClear());

describe('REDISCLOSURE_NOTICE', () => {
  test('is the exact 34 CFR 99.33 / 303.414 notice text', () => {
    expect(REDISCLOSURE_NOTICE).toBe(
      'This record contains confidential information protected by FERPA (34 CFR Part 99) and IDEA Part C (34 CFR 303.401-303.417). You may not redisclose it to any other party without prior written parental consent.'
    );
  });
});

describe('sendSevfToAgencyEmail (secure link, no attachments)', () => {
  const args = {
    practitionerName: 'Jane Doe',
    downloadUrl: 'https://api.example.com/api/shared-documents/acme/abc123',
    expiresAt: new Date('2026-11-04T12:00:00Z'),
    includesInvoice: true,
  };

  test('sends no attachments at all', async () => {
    await sendSevfToAgencyEmail('billing@agency.org', args);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.attachments).toBeUndefined();
    expect(payload.to).toBe('billing@agency.org');
  });

  test('contains the secure link, practitioner name and the redisclosure notice', async () => {
    await sendSevfToAgencyEmail('billing@agency.org', args);
    const { html, subject } = mockSend.mock.calls[0][0];
    expect(html).toContain(args.downloadUrl);
    expect(html).toContain('Jane Doe');
    expect(html).toContain(REDISCLOSURE_NOTICE);
    expect(subject).toContain('Jane Doe');
  });

  test('ignores any legacy PDF buffers a caller might still pass', async () => {
    await sendSevfToAgencyEmail('billing@agency.org', { ...args, pdfBuffer: Buffer.from('x'), invoiceBuffer: Buffer.from('y') });
    expect(mockSend.mock.calls[0][0].attachments).toBeUndefined();
  });
});

describe('generalizeSessionLocation', () => {
  test.each([
    ['123 Main St, Newark NJ', 'Home or community visit'],
    ["Child's home", 'Home or community visit'],
    ['Telehealth', 'Telehealth'],
    ['Zoom video call', 'Telehealth'],
    ['Sunrise Early Learning Center', 'Center'],
    ['ABC Clinic', 'Center'],
    ['Center', 'Center'],
    ['Home or community visit', 'Home or community visit'],
  ])('%s -> %s', (input, expected) => {
    expect(generalizeSessionLocation(input)).toBe(expected);
  });

  test('empty/null stays empty', () => {
    expect(generalizeSessionLocation('')).toBe('');
    expect(generalizeSessionLocation(null)).toBe('');
  });
});

describe('sendSessionScheduledEmail (child name removed)', () => {
  const base = {
    childFirstName: 'Timmy',
    practitionerName: 'Jane Doe',
    sessionDate: '2026-11-01',
    startTime: '10:00',
    endTime: '11:00',
    location: '42 Wallaby Way, Hoboken NJ',
    icsContent: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
  };

  test('subject and body never contain the child name or the raw address', async () => {
    await sendSessionScheduledEmail('parent@example.com', base);
    const { subject, html } = mockSend.mock.calls[0][0];
    expect(subject).not.toContain('Timmy');
    expect(html).not.toContain('Timmy');
    expect(html).not.toContain('Wallaby');
    expect(subject).toMatch(/Session scheduled/i);
    expect(html).toContain('Home or community visit');
    expect(html).toContain('Jane Doe');
  });

  test('cancelled variant also omits the child name', async () => {
    await sendSessionScheduledEmail('parent@example.com', { ...base, cancelled: true });
    const { subject, html } = mockSend.mock.calls[0][0];
    expect(subject).not.toContain('Timmy');
    expect(html).not.toContain('Timmy');
    expect(subject).toMatch(/Cancelled/i);
  });
});
