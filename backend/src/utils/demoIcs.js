// Calendar invite (.ics) for a booked demo call. Times are written in UTC so
// every calendar app places them correctly; a cancellation reuses the same UID
// so the existing event is removed instead of a second one appearing.
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function buildDemoIcs({
  bookingId, slotStart, slotEnd, attendeeEmail, attendeeName, organizerEmail, meetingUrl, cancelled = false,
}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Izaya EIS//Demo booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:demo-booking-${bookingId}@izayaedge.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(slotStart)}`,
    `DTEND:${stamp(slotEnd)}`,
    `SUMMARY:${esc('Izaya EIS demo')}`,
    `DESCRIPTION:${esc(`A 30-minute walkthrough of Izaya EIS.${meetingUrl ? ` Join: ${meetingUrl}` : ''}`)}`,
    ...(meetingUrl ? [`LOCATION:${esc(meetingUrl)}`, `URL:${meetingUrl}`] : []),
    `ORGANIZER;CN=Izaya EIS:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${esc(attendeeName)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${attendeeEmail}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `SEQUENCE:${cancelled ? 1 : 0}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

module.exports = { buildDemoIcs };
