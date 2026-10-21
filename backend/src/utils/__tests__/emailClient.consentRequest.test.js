// The consent-request email goes through Resend (no BAA), so it must carry
// nothing but a neutral message, the organization name, and the link: the
// signing page shows the details only after the parent verifies the DOB.
const mockSend = jest.fn().mockResolvedValue({ data: { id: 'msg_1' } });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));
process.env.RESEND_API_KEY = 'test-key';

const { sendConsentRequestEmail } = require('../emailClient');

afterEach(() => mockSend.mockClear());

describe('sendConsentRequestEmail', () => {
  const signUrl = 'https://app.example.com/eis/consent/acme/abc123';

  test('sends the link and organization name to the parent', async () => {
    await sendConsentRequestEmail('parent@x.com', { signUrl, organizationName: 'Acme EI' });
    const { to, html, subject } = mockSend.mock.calls[0][0];
    expect(to).toBe('parent@x.com');
    expect(html).toContain(signUrl);
    expect(html).toContain('Acme EI');
    expect(subject).toMatch(/consent/i);
  });

  test('ignores any child/recipient/record data a caller might pass', async () => {
    await sendConsentRequestEmail('parent@x.com', {
      signUrl, organizationName: 'Acme EI',
      childName: 'Timmy Tester', recipientName: 'ABC Billing', recordTypes: ['sevf_forms'], purpose: 'Billing audit',
    });
    const { html, subject } = mockSend.mock.calls[0][0];
    const all = `${subject} ${html}`;
    expect(all).not.toMatch(/Timmy|ABC Billing|sevf_forms|Billing audit/);
    expect(mockSend.mock.calls[0][0].attachments).toBeUndefined();
  });

  test('escapes the organization name', async () => {
    await sendConsentRequestEmail('parent@x.com', { signUrl, organizationName: '<b>Evil</b>' });
    expect(mockSend.mock.calls[0][0].html).not.toContain('<b>Evil</b>');
  });

  test('a resend is labelled as a reminder', async () => {
    await sendConsentRequestEmail('parent@x.com', { signUrl, organizationName: 'Acme EI', isResend: true });
    expect(mockSend.mock.calls[0][0].subject).toMatch(/reminder/i);
  });

  test('throws when Resend returns an error result instead of throwing (v6 { data, error } shape)', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field' } });
    await expect(sendConsentRequestEmail('bad', { signUrl, organizationName: 'Acme EI' })).rejects.toThrow(/Invalid `to` field/);
  });

  test('still throws when the send itself rejects', async () => {
    mockSend.mockRejectedValueOnce(new Error('network down'));
    await expect(sendConsentRequestEmail('parent@x.com', { signUrl, organizationName: 'Acme EI' })).rejects.toThrow('network down');
  });

  test('throws a clear error (never silently "succeeds") when RESEND_API_KEY is not configured', async () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      let isolated;
      jest.isolateModules(() => { isolated = require('../emailClient'); });
      await expect(isolated.sendConsentRequestEmail('parent@x.com', { signUrl, organizationName: 'Acme EI' }))
        .rejects.toThrow(/not configured/i);
    } finally {
      process.env.RESEND_API_KEY = saved;
    }
  });
});
