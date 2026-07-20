// Minimal single-event .ics builder — no external dependency needed for a
// single VEVENT invite. A stable per-session UID lets calendar apps treat a
// re-sent invite (after a reschedule) as an update to the same event rather
// than a duplicate.
const pad = (n) => String(n).padStart(2, '0');

// sessionDate: 'YYYY-MM-DD', time: 'HH:MM' (24h) — both already in the shape
// the app stores/collects them in (see assessments.start_time/end_time).
const toICSDateTime = (sessionDate, time) => {
  const [year, month, day] = sessionDate.split('-');
  const [hour, minute] = time.split(':');
  return `${year}${month}${day}T${pad(hour)}${pad(minute)}00`;
};

const escapeICSText = (text) =>
  String(text || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');

function buildSessionICS({ sessionId, sessionDate, startTime, endTime, summary, location, description, cancelled }) {
  const dtStart = toICSDateTime(sessionDate, startTime);
  const dtEnd = toICSDateTime(sessionDate, endTime);
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = `session-${sessionId}@izayaedge.com`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Izaya EIMS//Session Scheduling//EN',
    `METHOD:${cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICSText(summary)}`,
    location ? `LOCATION:${escapeICSText(location)}` : null,
    description ? `DESCRIPTION:${escapeICSText(description)}` : null,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    cancelled ? 'SEQUENCE:1' : 'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return lines.join('\r\n');
}

module.exports = { buildSessionICS };
