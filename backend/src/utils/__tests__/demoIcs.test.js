// The .ics attached to a demo booking: calendar apps must read the right UTC
// times, the meeting link, and (for a cancellation) the same UID so the
// existing event is removed rather than a second one added.
const { buildDemoIcs } = require('../demoIcs');

const base = {
  bookingId: 42,
  slotStart: new Date('2026-11-02T14:00:00Z'),
  slotEnd: new Date('2026-11-02T14:30:00Z'),
  attendeeEmail: 'dana@brightsteps.org',
  attendeeName: 'Dana Ruiz',
  organizerEmail: 'support@izayaedge.com',
  meetingUrl: 'https://meet.example.com/izaya',
};

test('a booking invite carries UTC times, the meeting link and a stable UID', () => {
  const ics = buildDemoIcs(base);
  expect(ics).toMatch(/METHOD:REQUEST/);
  expect(ics).toMatch(/DTSTART:20261102T140000Z/);
  expect(ics).toMatch(/DTEND:20261102T143000Z/);
  expect(ics).toMatch(/UID:demo-booking-42@izayaedge\.com/);
  expect(ics).toMatch(/URL:https:\/\/meet\.example\.com\/izaya/);
  expect(ics).toMatch(/LOCATION:https:\/\/meet\.example\.com\/izaya/);
  expect(ics.split('\r\n').length).toBeGreaterThan(10); // CRLF line endings, as the spec requires
});

test('a cancellation uses the same UID with METHOD:CANCEL', () => {
  const ics = buildDemoIcs({ ...base, cancelled: true });
  expect(ics).toMatch(/METHOD:CANCEL/);
  expect(ics).toMatch(/STATUS:CANCELLED/);
  expect(ics).toMatch(/UID:demo-booking-42@izayaedge\.com/);
});

test('commas, semicolons and newlines in text are escaped', () => {
  const ics = buildDemoIcs({ ...base, attendeeName: 'Ruiz, Dana; Director\nNJ' });
  expect(ics).toMatch(/Ruiz\\, Dana\\; Director\\nNJ/);
});

test('with no meeting link set, there is no URL line', () => {
  const ics = buildDemoIcs({ ...base, meetingUrl: null });
  expect(ics).not.toMatch(/^URL:/m);
});
