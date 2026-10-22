// Staff consent notices go through Resend (no BAA): neutral copy, no child
// data. Office staff only have the web dashboard and practitioners only have
// the mobile app, so each audience is told to look where they can actually go.
const mockSend = jest.fn().mockResolvedValue({ data: { id: 'msg_1' } });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));
process.env.RESEND_API_KEY = 'test-key';

const { sendConsentStaffNoticeEmail } = require('../emailClient');

afterEach(() => mockSend.mockClear());

const textOf = () => {
  const { html, subject } = mockSend.mock.calls[0][0];
  return `${subject} ${html.replace(/<[^>]+>/g, ' ')}`;
};

describe.each(['signed', 'withdrawn', 'expiring'])('%s notice', (kind) => {
  test('office audience points to the web dashboard, never the app', async () => {
    await sendConsentStaffNoticeEmail('office@x.org', { kind, audience: 'office' });
    const text = textOf();
    expect(text).toMatch(/Staff Directory/);
    expect(text).not.toMatch(/\bapp\b/i);
  });

  test('defaults to the office wording when no audience is given', async () => {
    await sendConsentStaffNoticeEmail('office@x.org', { kind });
    expect(textOf()).toMatch(/Staff Directory/);
  });

  test('practitioner audience points to the mobile app, never the dashboard', async () => {
    await sendConsentStaffNoticeEmail('prac@x.org', { kind, audience: 'practitioner' });
    const text = textOf();
    expect(text).toMatch(/Izaya EIS app/);
    expect(text).toMatch(/Consents/);
    expect(text).not.toMatch(/Staff Directory|dashboard/i);
  });

  test('carries no child, parent or recipient details either way', async () => {
    await sendConsentStaffNoticeEmail('x@x.org', { kind, audience: 'practitioner', childName: 'Timmy Tester', recipientName: 'ABC Billing' });
    expect(textOf()).not.toMatch(/Timmy|ABC Billing/);
  });
});

test('an unknown kind or audience is rejected rather than sent blank', async () => {
  await expect(sendConsentStaffNoticeEmail('x@x.org', { kind: 'nope' })).rejects.toThrow(/Unknown consent notice kind/);
  await expect(sendConsentStaffNoticeEmail('x@x.org', { kind: 'signed', audience: 'nope' })).rejects.toThrow(/Unknown consent notice audience/);
  expect(mockSend).not.toHaveBeenCalled();
});

test('practitioners are told the office sends the records (they cannot send from the app)', async () => {
  await sendConsentStaffNoticeEmail('prac@x.org', { kind: 'signed', audience: 'practitioner' });
  expect(textOf()).toMatch(/office/i);
});
