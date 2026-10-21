// The MFA self-recovery emails go through Resend (no BAA): link-only, neutral
// copy, never any child data.
const mockSend = jest.fn().mockResolvedValue({ data: { id: 'msg_1' } });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));
process.env.RESEND_API_KEY = 'test-key';

const { sendMfaResetEmail, sendMfaResetCompletedEmail } = require('../emailClient');

afterEach(() => mockSend.mockClear());

const resetUrl = 'https://izayaedge.com/eis/mfa-reset/acme/' + 'ab'.repeat(32);

describe('sendMfaResetEmail', () => {
  test('sends the link with the neutral copy to the account address', async () => {
    await sendMfaResetEmail('alex@gmail.com', { resetUrl, organizationName: 'Acme EI' });
    const { to, html, subject } = mockSend.mock.calls[0][0];
    expect(to).toBe('alex@gmail.com');
    expect(html).toContain(resetUrl);
    expect(html).toContain('Someone, hopefully you, asked to turn off two-step verification after losing access to the authenticator app.');
    expect(html).toContain('This link works once and expires in 30 minutes.');
    expect(html).toContain('If this was not you, ignore this email and change your password.');
    expect(subject).toMatch(/two-step verification/i);
  });

  test('ignores any child or record data a caller might pass, and escapes the org name', async () => {
    await sendMfaResetEmail('alex@gmail.com', { resetUrl, organizationName: '<b>Evil</b>', childName: 'Timmy Tester', patientId: 42, dob: '2024-01-01' });
    const { html, subject, attachments } = mockSend.mock.calls[0][0];
    const all = `${subject} ${html}`;
    expect(all).not.toMatch(/Timmy|2024-01-01|patientId/);
    expect(html).not.toContain('<b>Evil</b>');
    expect(attachments).toBeUndefined();
  });

  test('throws when Resend returns an error result', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'bad to' } });
    await expect(sendMfaResetEmail('x', { resetUrl })).rejects.toThrow(/bad to/);
  });

  test('throws when RESEND_API_KEY is not configured', async () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      let isolated;
      jest.isolateModules(() => { isolated = require('../emailClient'); });
      await expect(isolated.sendMfaResetEmail('alex@gmail.com', { resetUrl })).rejects.toThrow(/not configured/i);
    } finally {
      process.env.RESEND_API_KEY = saved;
    }
  });
});

describe('sendMfaResetCompletedEmail', () => {
  test('sends the notice copy with no link', async () => {
    await sendMfaResetCompletedEmail('alex@gmail.com');
    const { to, html } = mockSend.mock.calls[0][0];
    expect(to).toBe('alex@gmail.com');
    expect(html).toContain('Two-step verification was turned off on your Izaya EIS account. If this was not you, change your password now and contact your administrator.');
    expect(html).not.toContain('mfa-reset');
  });
});
