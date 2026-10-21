// sendSessionScheduledEmail goes through Resend (no BAA) — the caller must
// not put the child's name or a home address in the email args or the
// .ics it builds.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/emailClient', () => {
  const actual = jest.requireActual('../../utils/emailClient');
  return {
    sendSessionScheduledEmail: jest.fn().mockResolvedValue(),
    generalizeSessionLocation: actual.generalizeSessionLocation,
  };
});

const { pool } = require('../../config/db');
const { sendSessionScheduledEmail } = require('../../utils/emailClient');
const { createSession } = require('../scheduleController');

afterEach(() => jest.resetAllMocks());

test('createSession notifies the parent without the child name or raw address', async () => {
  const req = {
    practitioner: { practitionerId: 7 },
    body: { patientId: 42, sessionDate: '2099-01-01', startTime: '09:00', endTime: '10:00', location: '42 Wallaby Way, Hoboken' },
  };
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 42, first_name: 'Timmy', last_name: 'Turner', parent_email: 'p@example.com' }] })
    .mockResolvedValueOnce({ rows: [{ first_name: 'Jane', last_name: 'Doe' }] })
    .mockResolvedValueOnce({ rows: [{ id: 9, session_date: '2099-01-01', start_time: '09:00', end_time: '10:00', location: '42 Wallaby Way, Hoboken' }] })
    .mockResolvedValueOnce({ rows: [] }); // parent_notified_at update

  await createSession(req, res);

  expect(sendSessionScheduledEmail).toHaveBeenCalledTimes(1);
  const [to, args] = sendSessionScheduledEmail.mock.calls[0];
  expect(to).toBe('p@example.com');
  const serialized = JSON.stringify(args);
  expect(serialized).not.toContain('Timmy');
  expect(serialized).not.toContain('Turner');
  expect(serialized).not.toContain('Wallaby');
  expect(args.icsContent).toContain('SUMMARY:Session with Jane Doe');
  expect(args.icsContent).toContain('LOCATION:Home or community visit');
  expect(args.location).toBe('Home or community visit');
  expect(res.status).toHaveBeenCalledWith(201);
});
